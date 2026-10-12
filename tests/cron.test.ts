/**
 * Cron напоминаний: одновременные прогоны без дублей, бюджет времени, порядок
 * работы, быстрый ответ маршрута и устойчивость клиента Telegram.
 *
 * Прогоны идут поверх настоящего Postgres (PGlite): `Promise.all` двух
 * прогонов перемешивает их запросы на каждом await — ровно та гонка, что
 * бывает, когда внешний пингер и GitHub Actions срабатывают в одну минуту.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { startTestDb } from "./support/db";
import { installTelegramStub, type TelegramStub } from "./support/telegram";

// after() вне запроса Next бросает исключение — в тесте копим задачи и ждём их сами.
const afterTasks: Promise<unknown>[] = [];
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => unknown) => {
    afterTasks.push(Promise.resolve().then(task));
  },
}));

let stub: TelegramStub;
let nextId = 0;

beforeAll(async () => {
  process.env.BOT_TOKEN = "123456:AAHtestTOKENtestTOKENtestTOKENtestTO";
  process.env.NEXT_PUBLIC_SITE_URL = "https://qairu.example";
  stub = installTelegramStub();
  await startTestDb();
});

beforeEach(() => stub.reset());

const mods = async () => ({
  repo: await import("@/db/repo"),
  meeting: await import("@/bot/handlers/meeting"),
  attendance: await import("@/bot/handlers/attendance"),
  timeutils: await import("@/core/timeutils"),
  budget: await import("@/lib/budget"),
});

/** Отменить всё открытое, чтобы прогоны видели только встречи своего теста. */
async function cancelAll() {
  const { meetings } = await import("@/db/schema");
  const { getDb } = await import("@/db/client");
  await getDb().update(meetings).set({ status: "cancelled" });
}

/** Telegram-группа с людьми, у которых бот может писать в личку. */
async function telegramGroup(people: number) {
  const { repo } = await mods();
  nextId += 100;
  const chatId = -1_000_000_000 - nextId;
  await repo.upsertChat(chatId, `Группа ${nextId}`);
  await repo.updateChat(chatId, { reminderMin: 30 });
  const ids: number[] = [];
  for (let i = 1; i <= people; i += 1) {
    const userId = 10_000 + nextId + i;
    await repo.upsertUser({ userId, username: `u${userId}`, fullName: `Человек ${i}` });
    await repo.addMembership(chatId, userId);
    ids.push(userId);
  }
  return { chatId, ids };
}

/** Группа с сайта: напоминание идёт каждому лично. */
async function webGroup(people: number) {
  const { repo } = await mods();
  const chat = await repo.createWebChat({ title: "Проект", tz: "Asia/Almaty", lang: "ru" });
  await repo.updateChat(chat.chatId, { reminderMin: 30 });
  nextId += 100;
  const ids: number[] = [];
  for (let i = 1; i <= people; i += 1) {
    const userId = 20_000 + nextId + i;
    await repo.upsertUser({ userId, username: `w${userId}`, fullName: `Участник ${i}` });
    await repo.addMembership(chat.chatId, userId);
    ids.push(userId);
  }
  return { chatId: chat.chatId, ids };
}

/** Сколько раз каждому адресату ушло сообщение с этим кусочком текста. */
function deliveries(fragment: string): Map<number, number> {
  const counts = new Map<number, number>();
  for (const call of stub.of("sendMessage")) {
    if (!String(call.payload.text).includes(fragment)) continue;
    const to = Number(call.payload.chat_id);
    counts.set(to, (counts.get(to) ?? 0) + 1);
  }
  return counts;
}

describe("одновременные прогоны cron", () => {
  it("напоминания: два и пять прогонов разом — каждое сообщение ровно один раз", async () => {
    const { repo, meeting, timeutils } = await mods();
    await cancelAll();

    const tg = await telegramGroup(2);
    const web = await webGroup(4);
    const soon = new Date(Date.now() + 15 * 60_000);
    await repo.createMeeting({
      chatId: tg.chatId, initiatorId: tg.ids[0]!, place: "Ауд. 305", whenText: "скоро",
      goal: "Разовая-ТГ", invitees: tg.ids, whenStart: soon,
    });
    await repo.createMeeting({
      chatId: web.chatId, initiatorId: web.ids[0]!, place: "Коворкинг", whenText: "скоро",
      goal: "Разовая-сайт", invitees: web.ids, whenStart: soon,
    });
    // Серия: следующий повтор через 20 минут.
    const nextStart = new Date(Math.floor((Date.now() + 20 * 60_000) / 60_000) * 60_000);
    await repo.createMeeting({
      chatId: web.chatId, initiatorId: web.ids[0]!, place: "Библиотека", whenText: "по средам",
      goal: "Серия-сайт", invitees: web.ids,
      whenStart: new Date(nextStart.getTime() - 7 * 86_400_000),
      repeatUntil: timeutils.addDays(timeutils.todayIn("Asia/Almaty"), 60),
    });

    const runs = await Promise.all(Array.from({ length: 5 }, () => meeting.sendDueReminders()));
    // Всего дошло три напоминания — поделённые между прогонами, не умноженные.
    expect(runs.reduce((sum, n) => sum + n, 0)).toBe(3);

    expect([...deliveries("Разовая-ТГ").values()]).toEqual([1]);
    expect(deliveries("Разовая-ТГ").get(tg.chatId)).toBe(1);
    for (const goal of ["Разовая-сайт", "Серия-сайт"]) {
      const counts = deliveries(goal);
      expect([...counts.keys()].sort()).toEqual([...web.ids].sort());
      expect([...counts.values()].every((n) => n === 1)).toBe(true);
    }

    // И следующий прогон ничего не повторяет.
    stub.reset();
    expect(await meeting.sendDueReminders()).toBe(0);
    expect(stub.of("sendMessage")).toHaveLength(0);
  });

  it("«был ли ты»: параллельные прогоны спрашивают каждого один раз", async () => {
    const { repo, attendance } = await mods();
    await cancelAll();

    const web = await webGroup(3);
    const ended = await repo.createMeeting({
      chatId: web.chatId, initiatorId: web.ids[0]!, place: "Коворкинг", whenText: "сегодня",
      goal: "Закончилась", invitees: web.ids,
      whenStart: new Date(Date.now() - 70 * 60_000), durationMin: 60,
    });
    for (const userId of web.ids) await repo.setResponse({ meetingId: ended.id, userId, answer: "yes" });

    const runs = await Promise.all([attendance.askAttendance(), attendance.askAttendance(), attendance.askAttendance()]);
    expect(runs.reduce((sum, n) => sum + n, 0)).toBe(3);
    const counts = deliveries("Закончилась");
    expect([...counts.keys()].sort()).toEqual([...web.ids].sort());
    expect([...counts.values()].every((n) => n === 1)).toBe(true);
  });
});

describe("бюджет времени", () => {
  it("кончился бюджет — напоминание не забирается и уходит следующим прогоном", async () => {
    const { repo, meeting, budget } = await mods();
    await cancelAll();

    const tg = await telegramGroup(1);
    const created = await repo.createMeeting({
      chatId: tg.chatId, initiatorId: tg.ids[0]!, place: "", whenText: "скоро",
      goal: "Отложенная", invitees: tg.ids, whenStart: new Date(Date.now() + 10 * 60_000),
    });

    const tally = { due: 0, deferred: 0 };
    const spent = budget.timeBudget(0, 0);
    expect(await meeting.sendDueReminders(new Date(), tally, spent)).toBe(0);
    expect(tally).toEqual({ due: 1, deferred: 1 });
    expect((await repo.getMeeting(created.id))?.reminderSent).toBe(false);
    expect(stub.of("sendMessage")).toHaveLength(0);

    expect(await meeting.sendDueReminders()).toBe(1);
    expect(deliveries("Отложенная").get(tg.chatId)).toBe(1);
  });

  it("бюджет считает от старта и даёт запас на начатую работу", async () => {
    const { budget } = await mods();
    let now = 1_000;
    const b = budget.timeBudget(100, 50, () => now, 1_000);
    expect([b.canStart(), b.canContinue(), b.left()]).toEqual([true, true, 100]);
    now = 1_120;
    expect([b.canStart(), b.canContinue()]).toEqual([false, true]);
    now = 1_150;
    expect([b.canStart(), b.canContinue()]).toEqual([false, false]);
  });

  it("прогон целиком: сначала напоминания, потом «был ли ты», итог пишется для консоли", async () => {
    const { repo } = await mods();
    const { runReminderCron } = await import("@/lib/reminderCron");
    await cancelAll();

    const web = await webGroup(2);
    const ended = await repo.createMeeting({
      chatId: web.chatId, initiatorId: web.ids[0]!, place: "", whenText: "сегодня",
      goal: "Прошедшая", invitees: web.ids, whenStart: new Date(Date.now() - 70 * 60_000), durationMin: 60,
    });
    await repo.setResponse({ meetingId: ended.id, userId: web.ids[0]!, answer: "yes" });
    await repo.createMeeting({
      chatId: web.chatId, initiatorId: web.ids[0]!, place: "", whenText: "скоро",
      goal: "Скорая", invitees: web.ids, whenStart: new Date(Date.now() + 10 * 60_000),
    });

    const result = await runReminderCron();
    expect(result).toMatchObject({ ok: true, due: 1, sent: 1, deferred: 0, attendance: 1, calendars: 0 });

    const texts = stub.of("sendMessage").map((call) => String(call.payload.text));
    const lastReminder = Math.max(...texts.map((text, i) => (text.includes("Скорая") ? i : -1)));
    const firstQuestion = texts.findIndex((text) => text.includes("Прошедшая"));
    expect(lastReminder).toBeGreaterThanOrEqual(0);
    expect(firstQuestion).toBeGreaterThan(lastReminder);

    const run = await repo.lastCronRun();
    expect(run).toMatchObject({ ok: true, due: 1, sent: 1, attendance: 1 });
  });
});

describe("адрес cron", () => {
  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("отвечает сразу 202, а работа идёт после ответа; секрет — только заголовком", async () => {
    const { repo } = await mods();
    const { GET } = await import("@/app/api/cron/reminders/route");
    const call = (headers: Record<string, string> = {}, query = "") =>
      GET(new Request(`http://x/api/cron/reminders${query}`, { headers }));
    await cancelAll();
    // Записи метрик прошлых тестов (lib/metrics) тоже идут через after() — дождаться их.
    await Promise.all(afterTasks.splice(0));

    delete process.env.CRON_SECRET;
    expect((await call()).status).toBe(503);
    process.env.CRON_SECRET = "   ";
    expect((await call({ authorization: "Bearer    " })).status).toBe(503);

    process.env.CRON_SECRET = "s3cret-for-tests";
    expect((await call()).status).toBe(401);
    expect((await call({ authorization: "Bearer wrong" })).status).toBe(401);
    expect((await call({}, "?secret=s3cret-for-tests")).status).toBe(401);
    expect(afterTasks).toHaveLength(0);

    const tg = await telegramGroup(1);
    await repo.createMeeting({
      chatId: tg.chatId, initiatorId: tg.ids[0]!, place: "", whenText: "скоро",
      goal: "Через маршрут", invitees: tg.ids, whenStart: new Date(Date.now() + 10 * 60_000),
    });

    const ok = await call({ authorization: "Bearer s3cret-for-tests" });
    expect(ok.status).toBe(202);
    expect(await ok.json()).toEqual({ ok: true, accepted: true });
    expect(afterTasks).toHaveLength(1);
    await Promise.all(afterTasks.splice(0));
    expect(deliveries("Через маршрут").get(tg.chatId)).toBe(1);
  });

  it("maxDuration — максимум Hobby и больше бюджета с запасом", async () => {
    const route = await import("@/app/api/cron/reminders/route");
    const cron = await import("@/lib/reminderCron");
    expect(route.maxDuration).toBe(cron.CRON_MAX_DURATION_S);
    expect(cron.CRON_BUDGET_MS + cron.CRON_GRACE_MS).toBeLessThan(cron.CRON_MAX_DURATION_S * 1000);
  });
});

describe("клиент Telegram", () => {
  it("на 429 ждёт retry_after и повторяет один раз", async () => {
    const api = await import("@/bot/api");
    stub.rateLimit = { times: 1, retryAfter: 1 };
    const started = Date.now();
    await api.sendMessage({ chat_id: 1, text: "после 429" });
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    expect(stub.of("sendMessage")).toHaveLength(2);
  });

  it("второй 429 подряд и слишком долгий retry_after — ошибка, без бесконечных повторов", async () => {
    const api = await import("@/bot/api");
    stub.rateLimit = { times: 5, retryAfter: 1 };
    await expect(api.sendMessage({ chat_id: 1, text: "дважды" })).rejects.toMatchObject({ code: 429 });
    expect(stub.of("sendMessage")).toHaveLength(2);

    stub.reset();
    stub.rateLimit = { times: 5, retryAfter: api.telegramLimits.maxRetryAfterS + 1 };
    await expect(api.sendMessage({ chat_id: 1, text: "долго" })).rejects.toMatchObject({ code: 429 });
    expect(stub.of("sendMessage")).toHaveLength(1);
  });

  it("зависший Telegram обрывается по таймауту, а не держит прогон", async () => {
    const api = await import("@/bot/api");
    const saved = api.telegramLimits.timeoutMs;
    api.telegramLimits.timeoutMs = 50;
    try {
      stub.hang = true;
      const started = Date.now();
      await expect(api.sendMessage({ chat_id: 1, text: "висит" })).rejects.toThrow();
      expect(Date.now() - started).toBeLessThan(5_000);
      expect(stub.signals.every(Boolean)).toBe(true);
    } finally {
      api.telegramLimits.timeoutMs = saved;
    }
  });
});
