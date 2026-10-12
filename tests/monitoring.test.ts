/**
 * Мониторинг: `/api/healthz` с проверкой базы и пульс cron для healthchecks.io.
 *
 * База — настоящий Postgres (PGlite). Упавшая и зависшая база подменяются
 * на время теста тем же синглтоном `globalThis.__qairuDb`, который читает
 * `getDb()`; внешний сервис пульса — заглушкой fetch.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { startTestDb } from "./support/db";

type DbSlot = { __qairuDb?: unknown };
const slot = globalThis as unknown as DbSlot;
let realDb: unknown;

beforeAll(async () => {
  await startTestDb();
  realDb = slot.__qairuDb;
});

afterEach(() => {
  slot.__qairuDb = realDb;
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** База, у которой любой запрос падает с ошибкой драйвера (в ней — имя проекта Supabase). */
function brokenDb() {
  const fail = () => {
    throw new Error("password authentication failed for user postgres.secretproject");
  };
  return new Proxy({}, { get: () => fail });
}

const healthz = async (query = "") => {
  const { GET } = await import("@/app/api/healthz/route");
  return GET(new Request(`https://qairu.example/api/healthz${query}`));
};

describe("/api/healthz", () => {
  it("база отвечает — 200, время запроса, версия коммита, без кеша", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "b046073c1ca0315f54a50c19458bb72f702b1743");
    const response = await healthz();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({
      ok: true,
      db: { ok: true, ms: expect.any(Number) },
      version: "b046073",
      at: expect.any(String),
    });
    expect(Number.isNaN(Date.parse(body.at))).toBe(false);
    expect(body.db.ms).toBeLessThan(2_500);
  });

  it("локально версии нет — null", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    const body = await (await healthz()).json();
    expect(body.version).toBeNull();
  });

  it("база падает — 503, а текст ошибки наружу не уходит", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    slot.__qairuDb = brokenDb();
    const response = await healthz();
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({ ok: false, db: { ok: false, error: "unavailable" } });
    expect(text).not.toContain("secretproject");
    expect(text).not.toContain("password");
  });

  it("база молчит дольше 2,5 с — 503 timeout, ответ не ждёт драйвер", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    slot.__qairuDb = new Proxy({}, { get: () => () => new Promise(() => {}) });
    const { DB_TIMEOUT_MS } = await import("@/lib/health");

    const pending = healthz();
    await vi.advanceTimersByTimeAsync(DB_TIMEOUT_MS - 1);
    let settled = false;
    void pending.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const response = await pending;
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, db: { ok: false, error: "timeout" } });
  });

  it("?live — без базы: 200 даже при упавшей базе (проба готовности)", async () => {
    slot.__qairuDb = brokenDb();
    const response = await healthz("?live");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, db: null });
  });
});

describe("пульс cron (HEALTHCHECKS_PING_URL)", () => {
  const PING = "https://hc-ping.com/1f2e3d4c-0000-4000-8000-123456789abc";

  const okFetch = () => vi.fn<typeof fetch>(async () => new Response("OK", { status: 200 }));

  it("адрес: только https, без логина в адресе; хвостовой слэш срезается", async () => {
    const { healthchecksPingUrl } = await import("@/lib/config");
    vi.stubEnv("HEALTHCHECKS_PING_URL", ` ${PING}/ `);
    expect(healthchecksPingUrl()).toBe(PING);
    for (const bad of ["http://hc-ping.com/uuid", "hc-ping.com/uuid", "ftp://hc-ping.com/x", "https://u:p@hc-ping.com/x", "не адрес"]) {
      vi.stubEnv("HEALTHCHECKS_PING_URL", bad);
      expect(healthchecksPingUrl(), bad).toBe("");
    }
  });

  it("удачный прогон — GET на адрес, упавший — на <адрес>/fail", async () => {
    const { pingHeartbeat } = await import("@/lib/heartbeat");
    vi.stubEnv("HEALTHCHECKS_PING_URL", PING);
    const fetch = okFetch();

    expect(await pingHeartbeat(true, fetch)).toBe(true);
    expect(await pingHeartbeat(false, fetch)).toBe(true);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([PING, `${PING}/fail`]);
    for (const call of fetch.mock.calls as unknown as [string, RequestInit][]) {
      expect(call[1].method).toBe("GET");
      expect(call[1].signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("не задан, пуст или не https — запроса нет", async () => {
    const { pingHeartbeat } = await import("@/lib/heartbeat");
    const fetch = okFetch();
    for (const value of [undefined, "", "   ", "http://hc-ping.com/uuid"]) {
      vi.stubEnv("HEALTHCHECKS_PING_URL", value);
      expect(await pingHeartbeat(true, fetch)).toBe(false);
      expect(await pingHeartbeat(false, fetch)).toBe(false);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("сервис упал или ответил ошибкой — проглатывается, адрес в журнал не попадает", async () => {
    const { pingHeartbeat } = await import("@/lib/heartbeat");
    vi.stubEnv("HEALTHCHECKS_PING_URL", PING);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(pingHeartbeat(true, vi.fn(async () => Promise.reject(new TypeError("fetch failed"))))).resolves.toBe(false);
    await expect(pingHeartbeat(true, vi.fn(async () => new Response("", { status: 500 })))).resolves.toBe(false);
    expect(log).toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain("1f2e3d4c");
  });

  it("прогон cron: удачный пингует адрес, упавший — /fail, без адреса — ничего", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubEnv("BOT_TOKEN", "");
    const fetch = okFetch();
    vi.stubGlobal("fetch", fetch);
    const { runReminderCron } = await import("@/lib/reminderCron");

    vi.stubEnv("HEALTHCHECKS_PING_URL", PING);
    expect((await runReminderCron()).ok).toBe(true);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([PING]);

    slot.__qairuDb = brokenDb();
    expect((await runReminderCron()).ok).toBe(false);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([PING, `${PING}/fail`]);

    slot.__qairuDb = realDb;
    vi.stubEnv("HEALTHCHECKS_PING_URL", "");
    expect((await runReminderCron()).ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
