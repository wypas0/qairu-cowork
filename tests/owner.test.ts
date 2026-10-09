/**
 * Консоль владельца: второй фактор кодом от бота, сессии консоли, журнал и
 * статистика. Настоящая база (PGlite) и заглушка Bot API — код достаётся из
 * сообщения бота так же, как его видит владелец.
 */

import crypto from "node:crypto";

import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { startTestDb } from "./support/db";
import { installTelegramStub, type TelegramStub } from "./support/telegram";

const OWNER = 7_100_001;
const OUTSIDER = 7_100_002;
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
const client = { ip: "203.0.113.7", userAgent: CHROME };

let stub: TelegramStub;
let webToken: string;

async function mods() {
  return {
    repo: await import("@/db/repo"),
    console: await import("@/lib/ownerConsole"),
  };
}

const owner = { userId: OWNER, lang: "ru" };
const outsider = { userId: OUTSIDER, lang: "ru" };

/** Код из последнего сообщения бота владельцу. */
function lastCode(): string {
  const message = stub.of("sendMessage").filter((call) => call.payload.chat_id === OWNER).at(-1);
  const match = /<code>(\d{6})<\/code>/.exec(String(message?.payload.text ?? ""));
  if (!match) throw new Error("бот не прислал код");
  return match[1];
}

/** Неверный код, гарантированно не совпадающий с верным. */
function wrongOf(code: string): string {
  return String((Number(code) + 1) % 1_000_000).padStart(6, "0");
}

async function freshCode(now = new Date()): Promise<string> {
  const { console } = await mods();
  expect(await console.requestOwnerCode(owner, client, now)).toBe("sent");
  return lastCode();
}

beforeAll(async () => {
  process.env.BOT_TOKEN = "123456:AAHtestTOKENtestTOKENtestTOKENtestTO";
  process.env.ALERT_CHAT_ID = String(OWNER);
  process.env.OWNER_IDS = "";
  stub = installTelegramStub();
  await startTestDb();
  const { repo } = await mods();
  await repo.upsertUser({ userId: OWNER, username: "owner", fullName: "Владелец" });
  await repo.upsertUser({ userId: OUTSIDER, username: "someone", fullName: "Чужой" });
  webToken = await repo.issueWebSession(OWNER);
});

beforeEach(async () => {
  stub.reset();
  stub.blockedIds = [];
  process.env.ALERT_CHAT_ID = String(OWNER);
  const { repo } = await mods();
  // Лимиты — на человека; каждый тест начинает с чистого листа.
  for (const key of [`ownercode:${OWNER}`, `ownerfail:${OWNER}`]) await repo.deleteBotState(key);
  await repo.deleteOwnerCode(OWNER);
  await repo.deleteOwnerSessionsOf(OWNER);
});

describe("хеш кода", () => {
  it("HMAC с солью, id и ключом: в базе не sha256 кода, другой ключ — другой хеш", async () => {
    const { console } = await mods();
    const a = console.hashOwnerCode(OWNER, "123456", "salt1", "key-a");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(console.hashOwnerCode(OWNER, "123456", "salt1", "key-a")).toBe(a);
    expect(console.hashOwnerCode(OWNER, "123456", "salt2", "key-a")).not.toBe(a);
    expect(console.hashOwnerCode(OUTSIDER, "123456", "salt1", "key-a")).not.toBe(a);
    expect(console.hashOwnerCode(OWNER, "123456", "salt1", "key-b")).not.toBe(a);
    expect(a).not.toBe(crypto.createHash("sha256").update("123456").digest("hex"));
  });

  it("сравнение и разбор ввода", async () => {
    const { console } = await mods();
    expect(console.sameHash("ab", "ab")).toBe(true);
    expect(console.sameHash("ab", "ac")).toBe(false);
    expect(console.sameHash("ab", "abab")).toBe(false);
    expect(console.sameHash("", "")).toBe(false);
    expect(console.normalizeOwnerCode(" 123 456 ")).toBe("123456");
    expect(console.normalizeOwnerCode("123-456")).toBe("123456");
    expect(console.normalizeOwnerCode("12345")).toBeNull();
    expect(console.normalizeOwnerCode("12345a")).toBeNull();
    for (let i = 0; i < 50; i += 1) expect(console.newOwnerCode()).toMatch(/^\d{6}$/);
  });

  it("адрес в журнале — ключевой хеш, перебором IPv4 его не восстановить без ключа", async () => {
    const { console } = await mods();
    const print = console.fingerprint(client);
    expect(print.ipHash).not.toContain("203.0.113.7");
    expect(print.ipHash).not.toBe(crypto.createHash("sha256").update("203.0.113.7").digest("hex"));
    expect(print.device).toBe("Chrome · Windows");
  });
});

describe("не владелец", () => {
  it("кода не получает, войти не может, сессии у него нет", async () => {
    const { console } = await mods();
    expect(await console.requestOwnerCode(outsider, client)).toBe("not_owner");
    expect(stub.of("sendMessage")).toHaveLength(0);
    expect(await console.verifyOwnerCode(outsider, "123456", webToken, client)).toEqual({ status: "not_owner" });
    expect(await console.ownerConsoleSession(OUTSIDER, webToken, "x".repeat(43))).toBeNull();
  });

  it("группа в ALERT_CHAT_ID владельцем не считается", async () => {
    const { isOwner } = await import("@/lib/owner");
    process.env.ALERT_CHAT_ID = "-100123";
    expect(isOwner(-100123)).toBe(false);
    expect(isOwner(OWNER)).toBe(false);
  });
});

describe("код от бота", () => {
  it("приходит владельцу в личку, в базе — только хеш", async () => {
    const { repo } = await mods();
    const code = await freshCode();
    const dm = stub.last("sendMessage")!;
    expect(dm.payload.chat_id).toBe(OWNER);
    expect(String(dm.payload.text)).toContain("Chrome · Windows");

    const { getDb } = await import("@/db/client");
    const { ownerLoginCodes } = await import("@/db/schema");
    const rows = await getDb().select().from(ownerLoginCodes);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(code);
    expect(rows[0].codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].salt).toMatch(/^[0-9a-f]{32}$/);
    expect((await repo.pendingOwnerCode(OWNER))?.attempts).toBe(0);
  });

  it("верный код — сессия на 12 часов, одноразово, алерт о входе", async () => {
    const { console } = await mods();
    const code = await freshCode();
    stub.reset();
    const result = await console.verifyOwnerCode(owner, code, webToken, client);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.token).toMatch(console.OWNER_TOKEN_RE);
    expect(result.expiresAt.getTime() - Date.now()).toBeGreaterThan(11.9 * 3_600_000);
    expect(stub.lastText()).toContain("Вход в консоль");

    expect(await console.ownerConsoleSession(OWNER, webToken, result.token)).not.toBeNull();
    // Второй ввод того же кода — кода уже нет.
    expect(await console.verifyOwnerCode(owner, code, webToken, client)).toEqual({ status: "missing" });
  });

  it("в базе у сессии только SHA-256 токена", async () => {
    const { console, repo } = await mods();
    const result = await console.verifyOwnerCode(owner, await freshCode(), webToken, client);
    if (result.status !== "ok") throw new Error(result.status);
    const { getDb } = await import("@/db/client");
    const { ownerSessions } = await import("@/db/schema");
    const rows = await getDb().select().from(ownerSessions);
    expect(JSON.stringify(rows)).not.toContain(result.token);
    expect(rows[0].tokenHash).toBe(repo.hashToken(result.token));
    expect(rows[0].webTokenHash).toBe(repo.hashToken(webToken));
  });

  it("неверный код: остаток попыток, на 5-й код сгорает, алерты на 3-й и при блокировке", async () => {
    const { console, repo } = await mods();
    const code = await freshCode();
    stub.reset();
    const wrong = wrongOf(code);
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      expect(await console.verifyOwnerCode(owner, wrong, webToken, client)).toEqual({ status: "wrong", left: 5 - attempt });
    }
    expect(stub.of("sendMessage").filter((call) => String(call.payload.text).includes("неверные коды"))).toHaveLength(1);
    expect(await console.verifyOwnerCode(owner, wrong, webToken, client)).toEqual({ status: "locked" });
    expect(stub.lastText()).toContain("код сгорел");
    // Сгоревший код не принимается даже верным.
    expect(await console.verifyOwnerCode(owner, code, webToken, client)).toEqual({ status: "missing" });
    expect(await repo.pendingOwnerCode(OWNER)).toBeNull();
  });

  it("ввод не из 6 цифр попыткой не считается", async () => {
    const { console, repo } = await mods();
    await freshCode();
    expect(await console.verifyOwnerCode(owner, "12ab", webToken, client)).toEqual({ status: "format" });
    expect((await repo.pendingOwnerCode(OWNER))?.attempts).toBe(0);
  });

  it("код живёт 5 минут", async () => {
    const { console } = await mods();
    const start = new Date();
    const code = await freshCode(start);
    const late = new Date(start.getTime() + console.OWNER_CODE_TTL_MS + 1000);
    expect(await console.verifyOwnerCode(owner, code, webToken, client, late)).toEqual({ status: "expired" });
    expect(await console.verifyOwnerCode(owner, code, webToken, client)).toEqual({ status: "missing" });
  });

  it("новый код заменяет прежний", async () => {
    const { console } = await mods();
    const first = await freshCode();
    const second = await freshCode();
    if (first === second) return; // один шанс на миллион
    expect((await console.verifyOwnerCode(owner, first, webToken, client)).status).toBe("wrong");
    expect((await console.verifyOwnerCode(owner, second, webToken, client)).status).toBe("ok");
  });

  it("не больше 3 кодов за 15 минут", async () => {
    const { console } = await mods();
    for (let i = 0; i < 3; i += 1) expect(await console.requestOwnerCode(owner, client)).toBe("sent");
    expect(await console.requestOwnerCode(owner, client)).toBe("throttled");
  });

  it("10 неверных за час — вход закрыт, даже с новым кодом", async () => {
    const { console, repo } = await mods();
    for (let i = 0; i < console.OWNER_FAILS_PER_HOUR; i += 1) {
      await repo.bumpCounter(`ownerfail:${OWNER}`, console.OWNER_FAILS_WINDOW_MS);
    }
    const code = await freshCode();
    expect(await console.verifyOwnerCode(owner, code, webToken, client)).toEqual({ status: "throttled" });
  });

  it("бот не смог написать — код не остаётся в базе", async () => {
    const { console, repo } = await mods();
    stub.blockedIds = [OWNER];
    expect(await console.requestOwnerCode(owner, client)).toBe("send_failed");
    expect(await repo.pendingOwnerCode(OWNER)).toBeNull();
  });
});

describe("сессия консоли", () => {
  async function signIn(now = new Date()) {
    const { console } = await mods();
    const result = await console.verifyOwnerCode(owner, await freshCode(now), webToken, client, now);
    if (result.status !== "ok") throw new Error(result.status);
    return result.token;
  }

  it("привязана к сессии сайта и к человеку", async () => {
    const { console, repo } = await mods();
    const token = await signIn();
    const otherWeb = await repo.issueWebSession(OWNER);
    expect(await console.ownerConsoleSession(OWNER, otherWeb, token)).toBeNull();
    expect(await console.ownerConsoleSession(OUTSIDER, webToken, token)).toBeNull();
    expect(await console.ownerConsoleSession(OWNER, webToken, "garbage")).toBeNull();
    expect(await console.ownerConsoleSession(OWNER, webToken, token)).not.toBeNull();
    await repo.deleteWebSession(otherWeb);
  });

  it("истекает через 12 часов", async () => {
    const { console } = await mods();
    const now = new Date();
    const token = await signIn(now);
    const later = new Date(now.getTime() + console.OWNER_SESSION_TTL_MS + 1000);
    expect(await console.ownerConsoleSession(OWNER, webToken, token, later)).toBeNull();
  });

  it("пропадает, как только id убран из владельцев", async () => {
    const { console } = await mods();
    const token = await signIn();
    process.env.ALERT_CHAT_ID = "";
    expect(await console.ownerConsoleSession(OWNER, webToken, token)).toBeNull();
  });

  it("выход отзывает сессию на сервере", async () => {
    const { console } = await mods();
    const token = await signIn();
    await console.endOwnerSession(OWNER, token, client);
    expect(await console.ownerConsoleSession(OWNER, webToken, token)).toBeNull();
  });

  it("«Завершить все сессии» — все консоли и сайт на других устройствах, текущий сайт остаётся", async () => {
    const { console, repo } = await mods();
    const first = await signIn();
    const second = await signIn();
    const stranger = await repo.issueWebSession(OWNER);
    expect(await repo.countOwnerSessions(OWNER)).toBe(2);

    expect(await console.endAllOwnerSessions(OWNER, webToken, client)).toBe(2);
    expect(await console.ownerConsoleSession(OWNER, webToken, first)).toBeNull();
    expect(await console.ownerConsoleSession(OWNER, webToken, second)).toBeNull();
    expect(await repo.userByWebToken(stranger)).toBeNull();
    expect((await repo.userByWebToken(webToken))?.userId).toBe(OWNER);
  });

  it("журнал: события по порядку, адрес — хешем", async () => {
    const { repo } = await mods();
    const events = await repo.recentOwnerEvents(50);
    expect(events.map((event) => event.event)).toEqual(expect.arrayContaining(["code_sent", "login", "wrong", "logout_all"]));
    for (const event of events) {
      expect(event.ipHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(event)).not.toContain("203.0.113.7");
    }
  });
});

describe("статистика консоли", () => {
  it("одним запросом: люди, группы, встречи, таблицы базы", async () => {
    const { repo } = await mods();
    const stats = await repo.siteStats();
    expect(stats.users.total).toBeGreaterThanOrEqual(2);
    expect(stats.users.newDay).toBeGreaterThanOrEqual(2);
    expect(stats.users.mau).toBeGreaterThanOrEqual(1); // владелец заходил: сессия сайта
    expect(stats.users.signups.reduce((sum, point) => sum + point.count, 0)).toBe(stats.users.total);
    expect(stats.db.bytes).toBeGreaterThan(0);
    const audit = stats.db.tables.find((table) => table.name === "owner_audit");
    expect(audit?.rows).toBeGreaterThan(0);
    expect(stats.db.tables.find((table) => table.name === "users")?.rows).toBe(stats.users.total);
  });

  it("ряд по дням: пропуски — нулём, последний день — сегодня в поясе", async () => {
    const { repo } = await mods();
    const now = new Date("2026-10-09T20:30:00Z"); // в Алматы уже 10 октября
    const series = repo.dailySeries([{ day: "2026-10-08", count: 3 }], 5, now, "Asia/Almaty");
    expect(series.map((point) => point.day)).toEqual(["2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"]);
    expect(series.map((point) => point.count)).toEqual([0, 0, 3, 0, 0]);
  });

  it("прогоны cron копятся за неделю и обнуляются после неё", async () => {
    const { repo } = await mods();
    const at = Date.now();
    const run = { ok: true, attendance: 0, calendars: 0, sessions: 0 };
    await repo.recordCronRun({ ...run, at, due: 2, sent: 2 });
    await repo.recordCronRun({ ...run, at: at + 600_000, due: 3, sent: 1 });
    expect((await repo.lastCronRun())?.week).toMatchObject({ since: at, due: 5, sent: 3 });
    await repo.recordCronRun({ ...run, at: at + 8 * 86_400_000, due: 1, sent: 1 });
    expect((await repo.lastCronRun())?.week).toMatchObject({ due: 1, sent: 1 });
  });
});
