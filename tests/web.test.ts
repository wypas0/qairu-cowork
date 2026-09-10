/**
 * Сквозные тесты веб-версии поверх настоящего Postgres.
 *
 * HTTP-обвязка Next тут не поднимается: проверяется тот слой, где живёт вся
 * логика, — расчёт состояния группы, сетка, кворум, встречи, .ics и подпись
 * Telegram Mini App.
 */

import crypto from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import { startTestDb } from "./support/db";

const BOT_TOKEN = "123456:AAHtestTOKENtestTOKENtestTOKENtestTO";

beforeAll(async () => {
  await startTestDb();
});

async function mods() {
  const repo = await import("@/db/repo");
  const group = await import("@/lib/group");
  const grid = await import("@/core/grid");
  return { repo, group, grid };
}

/** Создать группу так же, как это делает форма на лендинге. */
async function makeGroup(title: string, name: string) {
  const { repo } = await mods();
  return repo.transaction(async (tx) => {
    const chat = await repo.createWebChat({ title, tz: "Asia/Almaty", lang: "ru" }, tx);
    const user = await repo.createWebUser({ fullName: name, lang: "ru" }, tx);
    await repo.addMembership(chat.chatId, user.userId, tx);
    return { chat, user };
  });
}

async function board(slug: string, options: { quorum?: number | null } = {}) {
  const { repo, group } = await mods();
  const chat = (await repo.getChatBySlug(slug))!;
  const state = await group.loadGroupState(chat, { quorum: options.quorum ?? null });
  return { chat, state, payload: group.toBoardPayload(state, chat.lang) };
}

describe("создание группы", () => {
  it("выдаёт слаг и делает создателя участником", async () => {
    const { repo } = await mods();
    const { chat, user } = await makeGroup("ИС-21", "Амир");
    expect(chat.slug).toMatch(/^[a-z0-9]{8}$/);
    expect(await repo.isMember(chat.chatId, user.userId)).toBe(true);
    expect(await repo.getChatBySlug("nosuchgroup")).toBeNull();
  });
});

describe("расписание и сетка", () => {
  it("парсер импорта тот же, что и в боте", async () => {
    const { parseAny, parseResultOk } = await import("@/core/parser");
    const parsed = parseAny("Пн 9:00-10:30 Матан\nСб 18:00-22:00 работа");
    expect(parseResultOk(parsed)).toBe(true);
    expect(new Set(parsed.slots.map((slot) => slot.kind))).toEqual(new Set(["class", "work"]));
    expect(parsed.slots[0].startMin).toBe(540);
    expect(parsed.slots[0].endMin).toBe(630);
  });

  it("битые строки отбрасываются, а не роняют сохранение", async () => {
    const { grid } = await mods();
    const cleaned = grid.cleanIncomingSlots([
      { weekday: 0, start: 540, end: 630 }, // ок
      { weekday: 9, start: 540, end: 630 }, // нет такого дня
      { weekday: 1, start: 700, end: 600 }, // конец раньше начала
      { weekday: 2, start: "нет", end: 600 }, // мусор
      { weekday: 3, start: 0, end: 2000 }, // выходит за сутки
      "вообще не объект",
    ]);
    expect(cleaned).toHaveLength(1);
    expect(cleaned[0]).toMatchObject({ weekday: 0, start: 540, end: 630, parity: null });
  });

  it("пока человек не сохранил расписание, он не «свободен всегда» — он неизвестен", async () => {
    const { chat, payload } = await board((await makeGroup("Свежая", "Амир")).chat.slug!);
    expect(chat.slug).toBeTruthy();
    expect(payload.total).toBe(0);
    expect(payload.days[0].cells.every((cell) => cell.count === 0)).toBe(true);
  });

  it("пустая сетка — осмысленный ответ «я свободен», а не отсутствие ответа", async () => {
    const { repo } = await mods();
    const { chat, user } = await makeGroup("Пустая сетка", "Амир");
    await repo.replaceWeeklySlots(user.userId, [0, 1, 2, 3, 4, 5, 6], [], "web");

    const { payload } = await board(chat.slug!);
    expect(payload.total).toBe(1);
    expect(payload.days[0].cells.every((cell) => cell.count === 1)).toBe(true);
  });

  it("сохранённое расписание сжимает окна", async () => {
    const { repo } = await mods();
    const { chat, user } = await makeGroup("Занятое утро", "Амир");
    await repo.replaceWeeklySlots(
      user.userId,
      [0, 1, 2, 3, 4, 5, 6],
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: 540, end: 630 })),
      "web",
    );

    const { payload } = await board(chat.slug!);
    const cells = payload.days[0].cells;
    const busy = cells.filter((cell) => cell.start >= 540 && cell.start < 630);
    const free = cells.filter((cell) => cell.start >= 630);
    expect(busy.length).toBeGreaterThan(0);
    expect(busy.every((cell) => cell.count === 0)).toBe(true);
    expect(free.length).toBeGreaterThan(0);
    expect(free.every((cell) => cell.count === 1)).toBe(true);
  });

  it("каждая строка сетки — свой получас, по возрастанию", async () => {
    const { repo } = await mods();
    const { chat, user } = await makeGroup("Сетка", "Амир");
    await repo.replaceWeeklySlots(user.userId, [0, 1, 2, 3, 4, 5, 6], [], "web");

    const { payload } = await board(chat.slug!);
    const starts = payload.days[0].cells.map((cell) => cell.start);
    expect(new Set(starts).size).toBe(starts.length);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    expect(starts[1] - starts[0]).toBe(30);
  });

  it("сетка редактора покрывает весь рабочий день", async () => {
    const { grid } = await mods();
    const times = grid.slotTimes(8 * 60, 22 * 60, 30);
    expect(times).toHaveLength(28); // 08:00–22:00 по 30 минут
    expect(times[0]).toBe(480);
    expect(times[times.length - 1]).toBe(1290);
  });
});

describe("второй участник и кворум", () => {
  it("кворум ослабляет требования и называет, кого не хватает", async () => {
    const { repo } = await mods();
    const { chat, user: owner } = await makeGroup("Кворум", "Амир");
    // Владелец занят весь понедельник.
    await repo.replaceWeeklySlots(
      owner.userId,
      [0, 1, 2, 3, 4, 5, 6],
      [{ weekday: 0, start: 0, end: 1440 }],
      "web",
    );

    const guest = await repo.createWebUser({ fullName: "Асель", lang: "ru" });
    await repo.addMembership(chat.chatId, guest.userId);
    await repo.replaceWeeklySlots(guest.userId, [0, 1, 2, 3, 4, 5, 6], [], "web");

    const { weekdayOf } = await import("@/core/timeutils");

    const all = await board(chat.slug!);
    expect(all.payload.total).toBe(2);

    const relaxed = await board(chat.slug!, { quorum: 1 });
    expect(relaxed.payload.quorum).toBe(1);
    expect(relaxed.payload.everyone).toBe(false);

    // Ищем понедельник — день, где владелец занят целиком. Там окно обязано
    // найтись, и в нём должно быть честно указано, что Амира не хватает.
    const busyDay = relaxed.state.grid.find((day) => weekdayOf(day.day) === 0);
    expect(busyDay).toBeDefined();
    const windowsThatDay = relaxed.payload.windows.find((day) => day.date === busyDay!.day);
    expect(windowsThatDay, "при кворуме 1 окно в понедельник обязано найтись").toBeDefined();
    expect(windowsThatDay!.items[0].missing).toContain("Амир");
  });
});

describe("встречи", () => {
  it("встреча из окна выгружается в календарь с верным UTC", async () => {
    const { repo } = await mods();
    const { buildIcs } = await import("@/core/calendar");
    const { zonedWallToUtc, chatTz } = await import("@/core/timeutils");

    const { chat, user } = await makeGroup("Встречи", "Амир");
    // 10:00 в Asia/Almaty (UTC+5) — это 05:00 UTC.
    const whenStart = zonedWallToUtc("2026-09-16", 10 * 60, chatTz(chat));
    const meeting = await repo.createMeeting({
      chatId: chat.chatId,
      initiatorId: user.userId,
      place: "Библиотека",
      whenText: "среда · 10:00–11:30",
      goal: "Разбор задач",
      invitees: [user.userId],
      whenStart,
    });

    const stored = (await repo.getMeeting(meeting.id))!;
    const ics = buildIcs({
      uid: `meeting-${stored.id}`,
      summary: stored.goal || chat.title,
      start: stored.whenStart!,
      durationMin: 90,
      location: stored.place,
      description: stored.goal,
    });
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("SUMMARY:Разбор задач");
    expect(ics).toContain("DTSTART:20260916T050000Z");
  });

  it("голоса меняются, комментарий сохраняется, встреча отменяется", async () => {
    const { repo } = await mods();
    const { chat, user } = await makeGroup("Голоса", "Амир");
    const meeting = await repo.createMeeting({
      chatId: chat.chatId,
      initiatorId: user.userId,
      place: "Кафе",
      whenText: "завтра",
      goal: "Обсудить",
      invitees: [user.userId],
    });

    await repo.setResponse({ meetingId: meeting.id, userId: user.userId, answer: "yes" });
    let answers = await repo.meetingResponsesFor(meeting.id);
    expect(answers.filter((row) => row.answer === "yes")).toHaveLength(1);

    await repo.setResponse({
      meetingId: meeting.id,
      userId: user.userId,
      answer: "change",
      comment: "лучше в 16:00",
    });
    answers = await repo.meetingResponsesFor(meeting.id);
    expect(answers.filter((row) => row.answer === "yes")).toHaveLength(0);
    expect(answers[0].comment).toBe("лучше в 16:00");

    await repo.updateMeeting(meeting.id, { status: "cancelled" });
    expect((await repo.getMeeting(meeting.id))?.status).toBe("cancelled");
  });

  it("время без метки окна не превращается в дату — напоминания не будет", async () => {
    const { repo } = await mods();
    const { chat, user } = await makeGroup("Свободный текст", "Амир");
    const meeting = await repo.createMeeting({
      chatId: chat.chatId,
      initiatorId: user.userId,
      place: "X",
      whenText: "как-нибудь на неделе",
      goal: "Y",
      invitees: [user.userId],
      whenStart: null,
    });
    expect((await repo.getMeeting(meeting.id))?.whenStart).toBeNull();
  });
});

describe("настройки группы", () => {
  it("меняют границы сетки", async () => {
    const { repo } = await mods();
    const { chat, user } = await makeGroup("Настройки", "Амир");
    await repo.replaceWeeklySlots(user.userId, [0, 1, 2, 3, 4, 5, 6], [], "web");
    await repo.updateChat(chat.chatId, {
      dayStartMin: 600,
      dayEndMin: 840,
      minSlotMin: 60,
      travelBufferMin: 15,
      semesterStart: "2026-09-01",
    });

    const { payload, state } = await board(chat.slug!);
    const cells = payload.days[0].cells;
    expect(cells[0].start).toBe(600);
    expect(cells[cells.length - 1].end).toBe(840);
    expect(state.slotTimes[0]).toBe(600);
  });
});

// --- Telegram Mini App ------------------------------------------------------

function signInitData(payload: Record<string, string>, token = BOT_TOKEN): string {
  const check = Object.keys(payload)
    .sort()
    .map((key) => `${key}=${payload[key]}`)
    .join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  const hash = crypto.createHmac("sha256", secret).update(check).digest("hex");
  return new URLSearchParams({ ...payload, hash }).toString();
}

describe("вход из Telegram Mini App", () => {
  const now = () => String(Math.floor(Date.now() / 1000));

  it("принимает корректную подпись", async () => {
    const { verifyInitData } = await import("@/lib/auth");
    const raw = signInitData({
      auth_date: now(),
      query_id: "AAF",
      user: JSON.stringify({ id: 777, first_name: "Амир" }),
    });
    expect(verifyInitData(raw, BOT_TOKEN).user?.id).toBe(777);
  });

  it("отвергает подделанные данные", async () => {
    const { InitDataError, verifyInitData } = await import("@/lib/auth");
    const raw = signInitData({ auth_date: now(), user: '{"id":1}' });
    const tampered = raw.replace("%22id%22%3A1", "%22id%22%3A2");
    expect(tampered).not.toBe(raw);
    expect(() => verifyInitData(tampered, BOT_TOKEN)).toThrow(InitDataError);
  });

  it("отвергает протухшие данные", async () => {
    const { InitDataError, verifyInitData } = await import("@/lib/auth");
    const stale = String(Math.floor(Date.now() / 1000) - 10 * 24 * 3600);
    const raw = signInitData({ auth_date: stale, user: '{"id":3}' });
    expect(() => verifyInitData(raw, BOT_TOKEN)).toThrow(InitDataError);
  });

  it("отвергает подпись чужого бота", async () => {
    const { InitDataError, verifyInitData } = await import("@/lib/auth");
    const raw = signInitData({ auth_date: now(), user: '{"id":4}' });
    expect(() =>
      verifyInitData(raw, "999999:OTHERtokenOTHERtokenOTHERtokenOTHE"),
    ).toThrow(InitDataError);
  });

  it("отвергает мусор без подписи", async () => {
    const { InitDataError, verifyInitData } = await import("@/lib/auth");
    expect(() => verifyInitData("user=1&hash=deadbeef", BOT_TOKEN)).toThrow(InitDataError);
    expect(() => verifyInitData("user=1", BOT_TOKEN)).toThrow(InitDataError);
  });

  it("без BOT_TOKEN проверить подпись нечем — это отказ, а не пропуск", async () => {
    const { InitDataError, verifyInitData } = await import("@/lib/auth");
    const raw = signInitData({ auth_date: now(), user: '{"id":5}' });
    expect(() => verifyInitData(raw, "")).toThrow(InitDataError);
  });

  it("привязывает телеграм-пользователя к группе как обычного участника", async () => {
    const { repo } = await mods();
    const { chat } = await makeGroup("Мини-апп", "Амир");

    // Ровно то, что делает /api/tg-auth после проверки подписи.
    const token = await repo.transaction(async (tx) => {
      await repo.upsertUser(
        { userId: 424242, username: "nurbek", fullName: "Нурбек", lang: "ru" },
        tx,
      );
      await repo.addMembership(chat.chatId, 424242, tx);
      return repo.issueWebSession(424242, tx);
    });

    expect((await repo.userByWebToken(token))?.userId).toBe(424242);
    expect(await repo.isMember(chat.chatId, 424242)).toBe(true);
    const members = await repo.chatMembers(chat.chatId);
    expect(members.map((member) => member.fullName)).toContain("Нурбек");
  });
});
