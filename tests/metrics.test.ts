/**
 * Метрики качества («Качество за 24 часа» в консоли): математика гистограммы,
 * атомарные приращения часовых корзин в bot_state, сводный запрос, задержка
 * напоминаний из настоящего прохода cron, классы сбоев Telegram и уборка.
 *
 * Настоящий Postgres (PGlite) и заглушка Bot API. `after()` здесь не
 * подменяется: вне запроса Next запись уходит сразу, её ждёт flushMetrics().
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { startTestDb } from "./support/db";
import { installTelegramStub, type TelegramStub } from "./support/telegram";

let stub: TelegramStub;
let nextId = 0;

beforeAll(async () => {
  process.env.BOT_TOKEN = "123456:AAHtestTOKENtestTOKENtestTOKENtestTO";
  process.env.NEXT_PUBLIC_SITE_URL = "https://qairu.example";
  stub = installTelegramStub();
  await startTestDb();
});

const mods = async () => ({
  core: await import("@/core/metrics"),
  repo: await import("@/db/repo"),
  metrics: await import("@/lib/metrics"),
  meeting: await import("@/bot/handlers/meeting"),
});

/** Дождаться записей прошлых шагов и начать с пустых корзин. */
async function clearMetrics() {
  const { metrics } = await mods();
  await metrics.flushMetrics();
  const { botState } = await import("@/db/schema");
  const { getDb } = await import("@/db/client");
  const { sql } = await import("drizzle-orm");
  await getDb().delete(botState).where(sql`${botState.key} like 'metric:%'`);
}

async function metricRow(key: string) {
  const { repo } = await mods();
  return repo.getBotState<Record<string, number | number[]>>(key);
}

beforeEach(async () => {
  stub.reset();
  stub.blockedIds = [];
  await clearMetrics();
});

afterEach(() => {
  delete process.env.QAIRU_METRICS;
});

describe("гистограмма и квантили", () => {
  it("ячейка по границе: граница — своя ячейка, дальше последней — «бесконечная»", async () => {
    const { core } = await mods();
    const bounds = core.LATENCY_BOUNDS_MS;
    expect(core.bucketOf(0, bounds)).toBe(0);
    expect(core.bucketOf(50, bounds)).toBe(0);
    expect(core.bucketOf(51, bounds)).toBe(1);
    expect(core.bucketOf(6400, bounds)).toBe(7);
    expect(core.bucketOf(6401, bounds)).toBe(8);
    expect(core.sampleDelta(123.6, bounds, { err: 1 })).toEqual({ n: 1, sum: 124, b2: 1, err: 1 });
  });

  it("p50 и p95 — интерполяцией внутри ячейки, хвост за границей — Infinity", async () => {
    const { core } = await mods();
    const bounds = core.LATENCY_BOUNDS_MS;
    // 90 быстрых (до 50 мс) и 10 медленных (200–400 мс).
    const counters = { n: 100, b0: 90, b3: 10 };
    expect(core.percentile(counters, 0.5, bounds)).toBeCloseTo((50 * 50) / 90, 5);
    expect(core.percentile(counters, 0.95, bounds)).toBeCloseTo(300, 5);
    expect(core.percentile(counters, 1, bounds)).toBeCloseTo(400, 5);
    expect(core.percentile({ b8: 3 }, 0.5, bounds)).toBe(Infinity);
    expect(core.percentile({ b0: 99, b8: 1 }, 0.95, bounds)).toBeLessThanOrEqual(50);
    expect(core.percentile({ b0: 94, b8: 6 }, 0.95, bounds)).toBe(Infinity);
    expect(core.percentile({}, 0.5, bounds)).toBeNull();
    expect(core.percentile(undefined, 0.95, bounds)).toBeNull();
  });

  it("задержка напоминания: от срока, но не раньше создания встречи", async () => {
    const { core } = await mods();
    const start = new Date("2026-10-11T10:00:00Z");
    const created = new Date("2026-10-01T00:00:00Z");
    // Срок — 09:30; ушло в 09:34 — 4 минуты.
    expect(core.reminderDelayS(start, 30, created, new Date("2026-10-11T09:34:00Z"))).toBe(240);
    // Встречу создали в 09:50 — раньше напомнить было нельзя: ушло в 09:51 — минута.
    expect(core.reminderDelayS(start, 30, new Date("2026-10-11T09:50:00Z"), new Date("2026-10-11T09:51:00Z"))).toBe(60);
    // Раньше срока (часы разошлись) — ноль, не минус.
    expect(core.reminderDelayS(start, 30, created, new Date("2026-10-11T09:29:00Z"))).toBe(0);
  });

  it("классы сбоев Telegram", async () => {
    const { core } = await mods();
    expect(core.tgFailureOf(403, "Forbidden: bot was blocked by the user")).toBe("forbidden");
    expect(core.tgFailureOf(429, "Too Many Requests")).toBe("rate");
    expect(core.tgFailureOf(0)).toBe("network");
    expect(core.tgFailureOf(400, "Bad Request: chat not found")).toBe("other");
    expect(core.tgFailureOf(502)).toBe("other");
    // Повторная правка того же текста — не сбой.
    expect(core.tgFailureOf(400, "Bad Request: message is not modified")).toBeNull();
  });
});

describe("приращения корзин", () => {
  it("50 одновременных приращений одной корзины — ни одно не теряется", async () => {
    const { core, repo } = await mods();
    const key = core.metricKey("board", Date.now());
    const samples = Array.from({ length: 50 }, (_, i) => (i % 2 === 0 ? 30 : 700));
    await Promise.all(
      samples.map((ms, i) =>
        repo.bumpMetrics([
          { key, data: core.sampleDelta(ms, core.LATENCY_BOUNDS_MS, i % 10 === 0 ? { err: 1 } : {}) },
          // Вторая корзина в той же пачке — в разном порядке: ключи сортируются, блокировки не встречаются.
          { key: core.metricKey("cron", Date.now()), data: { n: 1, at: [i] } },
        ].sort(() => (i % 2 === 0 ? 1 : -1))),
      ),
    );
    const row = await metricRow(key);
    expect(row).toMatchObject({ n: 50, sum: 25 * 30 + 25 * 700, b0: 25, b4: 25, err: 5 });
    const cron = await metricRow(core.metricKey("cron", Date.now()));
    expect(cron?.n).toBe(50);
    expect([...(cron?.at as number[])].sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_, i) => i));
  });

  it("замеры копятся в памяти и уходят одной пачкой; выключатель QAIRU_METRICS=off", async () => {
    const { core, metrics } = await mods();
    const done = metrics.routeTimer("state");
    done();
    metrics.observeRoute("state", performance.now() - 2500, true);
    metrics.observeTelegram(performance.now(), "rate");
    await metrics.flushMetrics();
    const state = await metricRow(core.metricKey("state", Date.now()));
    expect(state).toMatchObject({ n: 2, err: 1, b0: 1, b6: 1 });
    expect(await metricRow(core.metricKey("tg", Date.now()))).toMatchObject({ n: 1, rate: 1 });

    process.env.QAIRU_METRICS = "off";
    metrics.observeRoute("state", performance.now());
    await metrics.flushMetrics();
    expect((await metricRow(core.metricKey("state", Date.now())))?.n).toBe(2);
  });

  it("обёртка маршрута: 5xx и исключение — ошибка, 4xx — нет; ответ не меняется", async () => {
    const { core, metrics } = await mods();
    const route = metrics.timedRoute("schedule", async (status: number) => {
      if (status === 0) throw new Error("упал");
      return new Response(null, { status });
    });
    expect((await route(200)).status).toBe(200);
    expect((await route(403)).status).toBe(403);
    expect((await route(500)).status).toBe(500);
    await expect(route(0)).rejects.toThrow("упал");
    await metrics.flushMetrics();
    expect(await metricRow(core.metricKey("schedule", Date.now()))).toMatchObject({ n: 4, err: 2 });
  });

  it("сбой записи не роняет вызывающего", async () => {
    const { core, repo, metrics } = await mods();
    // Испорченная корзина (массив вместо объекта): Postgres не сольёт — запись упадёт внутри, наружу ничего.
    const key = core.metricKey("errors", Date.now());
    await repo.setBotState(key, [1]);
    metrics.countServerError();
    await expect(metrics.flushMetrics()).resolves.toBeUndefined();
    expect(await metricRow(key)).toEqual([1]);
  });
});

describe("сводный запрос qualityStats", () => {
  it("сутки и неделя по часам ключа, старые корзины не входят; перерывы cron", async () => {
    const { core, repo } = await mods();
    const now = new Date("2026-10-11T12:30:00Z");
    const at = (hoursAgo: number) => now.getTime() - hoursAgo * 3_600_000;
    const bump = (name: Parameters<typeof core.metricKey>[0], hoursAgo: number, data: Record<string, number | number[]>) =>
      repo.bumpMetrics([{ key: core.metricKey(name, at(hoursAgo)), data }]);

    await bump("board", 0, { n: 10, b0: 9, b6: 1, err: 1 });
    await bump("board", 20, { n: 10, b1: 10 });
    await bump("board", 30, { n: 5, b7: 5 });
    await bump("board", 24 * 9, { n: 1000, b8: 1000 });
    // Прогоны cron: в сутках — 9,1, 9, 6 часов и 40 минут назад; до них — 52 и 100 часов назад.
    const s = (hoursAgo: number) => Math.round(at(hoursAgo) / 1000);
    await bump("cron", 9, { n: 2, at: [s(9.1), s(9)] });
    await bump("cron", 6, { n: 1, budget: 1, at: [s(6)] });
    await bump("cron", 0, { n: 1, at: [s(40 / 60)] });
    // За неделей — долгий перерыв в 2 дня (между 100 и 52 часами назад).
    await bump("cron", 100, { n: 1, at: [s(100)] });
    await bump("cron", 52, { n: 1, err: 1, at: [s(52)] });

    const stats = await repo.qualityStats(now);
    expect(stats.day.board).toMatchObject({ n: 20, b0: 9, b1: 10, b6: 1, err: 1 });
    expect(stats.week.board).toMatchObject({ n: 25, b7: 5 });
    expect(stats.week.board?.b8).toBeUndefined();
    expect(stats.day.cron).toMatchObject({ n: 4, budget: 1 });
    expect(stats.day.cron?.err).toBeUndefined();
    expect(stats.week.cron).toMatchObject({ n: 6, err: 1 });
    expect(stats.cron.lastAt).toBe(s(40 / 60) * 1000);
    // Перерыв, закончившийся в окне суток, считается целиком: от 52 до 9,1 часа назад.
    expect(stats.cron.dayGapS).toBeCloseTo((52 - 9.1) * 3600, -1);
    expect(stats.cron.weekGapS).toBeCloseTo(48 * 3600, -1);

    // p95 доски за сутки: 19-й замер из 20 — последний в ячейке 50–100 мс, медленный 20-й не в счёт.
    expect(core.percentile(stats.day.board, 0.95, core.LATENCY_BOUNDS_MS)).toBeLessThanOrEqual(100);
  });

  it("cron встал совсем — перерыв тянется до «сейчас»; без прогонов — null", async () => {
    const { core, repo } = await mods();
    const now = new Date("2026-10-11T12:30:00Z");
    expect((await repo.qualityStats(now)).cron).toEqual({ lastAt: null, dayGapS: null, weekGapS: null });

    const last = now.getTime() - 3 * 3_600_000;
    await repo.bumpMetrics([{ key: core.metricKey("cron", last), data: { n: 1, at: [last / 1000] } }]);
    const stats = await repo.qualityStats(now);
    expect(stats.cron.dayGapS).toBe(3 * 3600);
    expect(Object.keys(stats.day)).toEqual(["cron"]);
  });
});

describe("cron: задержка напоминаний, сбои, уборка", () => {
  /** Telegram-группа с одним человеком и встречей через `inMin` минут. */
  async function groupWithMeeting(goal: string, inMin: number) {
    const { repo } = await mods();
    nextId += 1;
    const chatId = -1_000_000_500 - nextId;
    const userId = 50_000 + nextId;
    await repo.upsertChat(chatId, `Группа ${nextId}`);
    await repo.updateChat(chatId, { reminderMin: 30 });
    await repo.upsertUser({ userId, username: `m${userId}`, fullName: "Человек" });
    await repo.addMembership(chatId, userId);
    await repo.createMeeting({
      chatId, initiatorId: userId, place: "", whenText: "скоро", goal, invitees: [userId],
      whenStart: new Date(Date.now() + inMin * 60_000),
    });
    return { chatId };
  }

  async function cancelAll() {
    const { meetings } = await import("@/db/schema");
    const { getDb } = await import("@/db/client");
    await getDb().update(meetings).set({ status: "cancelled" });
  }

  it("ушедшее вовремя и опоздавшее напоминание, не дошедшее — отдельным счётчиком", async () => {
    const { core, repo, metrics, meeting } = await mods();
    await cancelAll();
    await groupWithMeeting("Вовремя", 20);
    // Встреча через 40 минут при пороге 30: срок — через 10 минут. «Сейчас» прохода —
    // через 22 минуты: до начала 18 минут, напоминание ушло на 12 минут позже срока.
    await groupWithMeeting("Поздно", 40);
    const blocked = await groupWithMeeting("Не дойдёт", 15);
    stub.blockedIds = [blocked.chatId];

    expect(await meeting.sendDueReminders()).toBe(1);
    expect(await meeting.sendDueReminders(new Date(Date.now() + 22 * 60_000))).toBe(1);
    await metrics.flushMetrics();

    const stats = await repo.qualityStats();
    const reminder = stats.day.reminder;
    expect(reminder).toMatchObject({ n: 2, late: 1, failed: 1 });
    // Одно — меньше 30 секунд, второе — в ячейке 10–15 минут.
    expect(reminder).toMatchObject({ b0: 1, b5: 1 });
    expect(core.percentile(reminder, 0.95, core.DELAY_BOUNDS_S)).toBeGreaterThan(600);
    // 403 на напоминание в чат — сбой класса «бот заблокирован».
    expect(stats.day.tg).toMatchObject({ forbidden: 1 });
  });

  it("Telegram: 429 после повтора, таймаут и 403 — каждый в свой класс", async () => {
    const { core, metrics } = await mods();
    const api = await import("@/bot/api");
    stub.rateLimit = { times: 2, retryAfter: 0 };
    await expect(api.sendMessage({ chat_id: 1, text: "лимит" })).rejects.toMatchObject({ code: 429 });
    stub.blockedIds = [2];
    await expect(api.sendMessage({ chat_id: 2, text: "блок" })).rejects.toMatchObject({ code: 403 });
    const saved = api.telegramLimits.timeoutMs;
    api.telegramLimits.timeoutMs = 30;
    try {
      stub.hang = true;
      await expect(api.sendMessage({ chat_id: 3, text: "висит" })).rejects.toThrow();
    } finally {
      api.telegramLimits.timeoutMs = saved;
      stub.hang = false;
    }
    await api.sendMessage({ chat_id: 4, text: "дошло" });
    await metrics.flushMetrics();
    expect(await metricRow(core.metricKey("tg", Date.now()))).toMatchObject({ n: 4, rate: 1, forbidden: 1, network: 1 });
  });

  it("прогон cron записывает себя и убирает корзины старше 8 дней", async () => {
    const { core, repo } = await mods();
    const { runReminderCron } = await import("@/lib/reminderCron");
    await cancelAll();
    const old = core.metricKey("board", Date.now() - 9 * 86_400_000);
    const kept = core.metricKey("board", Date.now() - 7 * 86_400_000);
    await repo.bumpMetrics([{ key: old, data: { n: 1 } }, { key: kept, data: { n: 1 } }]);

    const startedAt = Date.now();
    const result = await runReminderCron(startedAt);
    expect(result).toMatchObject({ ok: true, budgetHit: false });
    expect(await metricRow(old)).toBeNull();
    expect(await metricRow(kept)).toMatchObject({ n: 1 });

    const cron = await metricRow(core.metricKey("cron", startedAt));
    expect(cron).toMatchObject({ n: 1, budget: 0, err: 0, at: [Math.round(startedAt / 1000)] });

    // Бюджет кончился сразу — прогон помечен.
    const { timeBudget } = await import("@/lib/budget");
    expect((await runReminderCron(Date.now(), timeBudget(0))).budgetHit).toBe(true);
    expect((await repo.qualityStats()).day.cron).toMatchObject({ n: 2, budget: 1 });
  });

  it("уборка по часу в ключе: свежая корзина остаётся, даже если её давно не трогали", async () => {
    const { core, repo } = await mods();
    const now = new Date("2026-10-11T12:00:00Z");
    const fresh = core.metricKey("state", now.getTime() - 7.9 * 86_400_000);
    const stale = core.metricKey("state", now.getTime() - 8.1 * 86_400_000);
    await repo.bumpMetrics([{ key: fresh, data: { n: 1 } }, { key: stale, data: { n: 1 } }]);
    expect(await repo.deleteOldMetrics(now)).toBe(1);
    expect(await metricRow(fresh)).not.toBeNull();
    expect(await metricRow(stale)).toBeNull();
  });
});
