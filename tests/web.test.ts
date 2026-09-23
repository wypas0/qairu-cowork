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

async function board(
  slug: string,
  options: { quorum?: number | null; week?: number; viewerId?: number } = {},
) {
  const { repo, group } = await mods();
  const chat = (await repo.getChatBySlug(slug))!;
  const state = await group.loadGroupState(chat, {
    quorum: options.quorum ?? null,
    week: options.week ?? 0,
  });
  return {
    chat,
    state,
    payload: group.toBoardPayload(state, chat.lang, options.viewerId),
  };
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

  it("клетка знает id свободных, а доска — сегодня и пояс группы", async () => {
    const { repo } = await mods();
    const { chat, user } = await makeGroup("Подсветка", "Амир");
    await repo.replaceWeeklySlots(
      user.userId,
      [0, 1, 2, 3, 4, 5, 6],
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: 540, end: 630 })),
      "web",
    );

    const { payload, state } = await board(chat.slug!);
    expect(payload.tz).toBe("Asia/Almaty");
    expect(payload.today).toBe(state.today);
    for (const cell of payload.days[0].cells) {
      // По id карта подсвечивает человека — они обязаны совпадать с именами.
      expect(cell.freeIds.length).toBe(cell.count);
      expect(cell.freeIds.includes(user.userId)).toBe(cell.free.length === 1);
    }
  });

  it("каждая строка сетки — свой получас, по возрастанию", async () => {
    const { repo } = await mods();
    const { chat, user } = await makeGroup("Сетка", "Амир");
    await repo.replaceWeeklySlots(user.userId, [0, 1, 2, 3, 4, 5, 6], [], "web");

    const { payload } = await board(chat.slug!);
    const starts = payload.days[0].cells.map((cell) => cell.start);
    expect(new Set(starts).size).toBe(starts.length);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    expect(starts.slice(0, 4)).toEqual([480, 540, 600, 670]); // 08:00, 09:00, 10:00, 11:10
    expect(payload.periods[3]).toMatchObject({ n: 4, start: 670, end: 720, breakBefore: 20 });
  });

  it("сетка по парам как на портале: 50 минут, после 3-й пары перерыв 20 минут", async () => {
    const { grid } = await mods();
    const periods = grid.lessonPeriods(8 * 60, 22 * 60);
    const text = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    expect(periods.slice(0, 6).map((p) => `${p.n} ${text(p.start)}-${text(p.end)}`)).toEqual([
      "1 08:00-08:50",
      "2 09:00-09:50",
      "3 10:00-10:50",
      "4 11:10-12:00",
      "5 12:10-13:00",
      "6 13:10-14:00",
    ]);
    expect(periods.map((p) => p.breakBefore).filter((m) => m >= grid.BREAK_ROW_MIN)).toEqual([20]);
    expect(periods.every((p) => p.end <= 22 * 60)).toBe(true);
    // Часы группы короче одной пары — запасная сетка по 30 минут.
    expect(grid.gridPeriods(600, 640, 30).map((p) => [p.n, p.start, p.end])).toEqual([[0, 600, 630], [0, 630, 640]]);
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
    // Подсказка при наведении: в понедельник свободна только Асель, Амир занят.
    const mondayCell = all.payload.days[0].cells[0];
    expect(mondayCell.free).toEqual(["Асель"]);
    expect(mondayCell.missing).toEqual(["Амир"]);

    const relaxed = await board(chat.slug!, { quorum: 1 });
    expect(relaxed.payload.quorum).toBe(1);
    expect(relaxed.payload.everyone).toBe(false);

    // Занятость еженедельная, поэтому понедельник владельца занят целиком
    // в любую неделю — в том числе в те 7 дней вперёд от сегодня, на которые
    // считаются варианты встречи. Там обязан найтись вариант с честной
    // пометкой, что Амира не хватает.
    const monday = relaxed.payload.slotDays.find((day) => weekdayOf(day.date) === 0);
    expect(monday, "понедельник обязан быть среди ближайших 7 дней").toBeDefined();
    expect(monday!.items.length, "при кворуме 1 вариант в понедельник обязан найтись").toBeGreaterThan(0);
    expect(monday!.items[0].missing).toContain("Амир");
    // Без кворума в понедельник вариантов нет: Амир занят весь день.
    expect(all.payload.slotDays.find((day) => weekdayOf(day.date) === 0)!.items).toHaveLength(0);
  });

  it("тепловая карта всегда начинается с понедельника, независимо от текущего дня недели", async () => {
    const { chat } = await makeGroup("Неделя с понедельника", "Амир");
    const { state } = await board(chat.slug!);
    const { weekdayOf } = await import("@/core/timeutils");
    expect(state.grid).toHaveLength(7);
    expect(weekdayOf(state.grid[0].day)).toBe(0);
    expect(weekdayOf(state.grid[6].day)).toBe(6);
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

describe("встречи на тепловой карте", () => {
  it("назначенная встреча занимает свои клетки, отменённая пропадает", async () => {
    const { repo } = await mods();
    const { chat, user } = await makeGroup("Встречи на карте", "Амир");
    await repo.replaceWeeklySlots(user.userId, [0, 1, 2, 3, 4, 5, 6], [], "web");
    const { todayIn, zonedWallToUtc } = await import("@/core/timeutils");
    const today = todayIn("Asia/Almaty");

    const meeting = await repo.createMeeting({
      chatId: chat.chatId,
      initiatorId: user.userId,
      place: "Коворкинг",
      whenText: "сегодня · 11:10–13:00",
      goal: "Проект",
      invitees: [user.userId],
      whenStart: zonedWallToUtc(today, 670, "Asia/Almaty"),
    });
    // Без точного времени на карту не попадает.
    await repo.createMeeting({
      chatId: chat.chatId,
      initiatorId: user.userId,
      place: "",
      whenText: "как-нибудь",
      goal: "Без времени",
      invitees: [user.userId],
    });

    const { payload } = await board(chat.slug!);
    expect(payload.meetings).toEqual([{ id: meeting.id, date: today, start: 670, end: 780, title: "Проект" }]);

    await repo.updateMeeting(meeting.id, { status: "cancelled" });
    expect((await board(chat.slug!)).payload.meetings).toEqual([]);
  });

  it("конец встречи — из текста времени, иначе полтора часа", async () => {
    const { group } = await mods();
    const { zonedWallToUtc } = await import("@/core/timeutils");
    const base = { id: 1, goal: "", place: "Кафе", whenStart: zonedWallToUtc("2026-09-16", 900, "Asia/Almaty") };
    expect(group.meetingSpan({ ...base, whenText: "ср · 15:00–16:30" }, "Asia/Almaty")).toEqual({
      id: 1,
      date: "2026-09-16",
      start: 900,
      end: 990,
      title: "Кафе",
    });
    expect(group.meetingSpan({ ...base, whenText: "завтра после пар" }, "Asia/Almaty")?.end).toBe(990);
    expect(group.meetingSpan({ ...base, whenText: "9:00-10:00" }, "Asia/Almaty")?.end).toBe(990);
    expect(group.meetingSpan({ ...base, whenStart: null, whenText: "" }, "Asia/Almaty")).toBeNull();
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
    expect(state.periods[0]).toMatchObject({ n: 3, start: 600, end: 650 });
  });
});

describe("выход из группы и профиль", () => {
  it("выход убирает из участников и из списка групп, но не удаляет группу", async () => {
    const { repo } = await mods();
    const { chat, user } = await makeGroup("Уходим", "Амир");

    expect(await repo.isMember(chat.chatId, user.userId)).toBe(true);
    expect((await repo.userChats(user.userId)).map((c) => c.chatId)).toContain(chat.chatId);

    await repo.removeMembership(chat.chatId, user.userId);

    expect(await repo.isMember(chat.chatId, user.userId)).toBe(false);
    expect((await repo.userChats(user.userId)).map((c) => c.chatId)).not.toContain(chat.chatId);
    expect(await repo.getChatBySlug(chat.slug!)).not.toBeNull();
  });

  it("вышедший может вернуться по той же ссылке-приглашению и не теряет расписание", async () => {
    const { repo } = await mods();
    const { chat, user } = await makeGroup("Возврат", "Амир");
    await repo.replaceWeeklySlots(user.userId, [0], [{ weekday: 0, start: 540, end: 630 }], "web");

    await repo.removeMembership(chat.chatId, user.userId);
    expect(await repo.isMember(chat.chatId, user.userId)).toBe(false);

    await repo.addMembership(chat.chatId, user.userId);
    expect(await repo.isMember(chat.chatId, user.userId)).toBe(true);
    expect(await repo.getSlots(user.userId)).toHaveLength(1);
  });

  it("userMeetings собирает открытые встречи по всем группам пользователя, без отменённых и чужих", async () => {
    const { repo } = await mods();
    const { chat: chatA, user } = await makeGroup("Профиль А", "Амир");
    const { chat: chatB } = await makeGroup("Профиль Б", "Асель");
    await repo.addMembership(chatB.chatId, user.userId);

    const meetingA = await repo.createMeeting({
      chatId: chatA.chatId,
      initiatorId: user.userId,
      place: "Кафе",
      whenText: "пн",
      goal: "A",
      invitees: [user.userId],
    });
    const meetingB = await repo.createMeeting({
      chatId: chatB.chatId,
      initiatorId: user.userId,
      place: "Библиотека",
      whenText: "вт",
      goal: "B",
      invitees: [user.userId],
    });
    const cancelled = await repo.createMeeting({
      chatId: chatA.chatId,
      initiatorId: user.userId,
      place: "X",
      whenText: "ср",
      goal: "Отменённая",
      invitees: [user.userId],
    });
    await repo.updateMeeting(cancelled.id, { status: "cancelled" });

    const other = await repo.createWebUser({ fullName: "Чужой", lang: "ru" });
    const { chat: chatC } = await makeGroup("Не моя группа", "Чужой2");
    await repo.addMembership(chatC.chatId, other.userId);
    await repo.createMeeting({
      chatId: chatC.chatId,
      initiatorId: other.userId,
      place: "Y",
      whenText: "чт",
      goal: "Не видно",
      invitees: [other.userId],
    });

    const rows = await repo.userMeetings(user.userId);
    const ids = rows.map((row) => row.meeting.id);
    expect(ids).toContain(meetingA.id);
    expect(ids).toContain(meetingB.id);
    expect(ids).not.toContain(cancelled.id);
    expect(rows.every((row) => row.meeting.goal !== "Не видно")).toBe(true);
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

describe("лучшее время и переход по неделям", () => {
  it("предлагает окна, где свободно больше всего людей, и не предлагает занятое встречей", async () => {
    const { repo } = await mods();
    const { chat, user } = await makeGroup("Лучшее время", "Амир");
    const { zonedWallToUtc } = await import("@/core/timeutils");

    const guest = await repo.createWebUser({ fullName: "Асель", lang: "ru" });
    await repo.addMembership(chat.chatId, guest.userId);
    // Оба свободны везде, кроме утра: у Амира занято до 12:00 каждый день.
    await repo.replaceWeeklySlots(
      user.userId,
      [0, 1, 2, 3, 4, 5, 6],
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: 0, end: 12 * 60 })),
      "web",
    );
    await repo.replaceWeeklySlots(guest.userId, [0, 1, 2, 3, 4, 5, 6], [], "web");

    const { payload } = await board(chat.slug!, { quorum: 1 });
    expect(payload.best.length).toBeGreaterThan(0);
    // Сверху — окна, где свободны оба, а не те, где остался один человек.
    expect(payload.best[0].count).toBe(2);
    expect(payload.best[0].start).toBeGreaterThanOrEqual(12 * 60);

    // Назначаем встречу на первое же предложение — больше его предлагать нельзя.
    const first = payload.best[0];
    const tz = "Asia/Almaty";
    await repo.createMeeting({
      chatId: chat.chatId,
      initiatorId: user.userId,
      place: "",
      whenText: "занято",
      goal: "Занято",
      invitees: [user.userId, guest.userId],
      whenStart: zonedWallToUtc(first.dates[0].date as import("@/core/timeutils").DateStr, first.start, tz),
    });

    const after = await board(chat.slug!, { quorum: 1 });
    const sameSlot = after.payload.best.find(
      (item) => item.start === first.start && item.dates.some((d) => d.date === first.dates[0].date),
    );
    expect(sameSlot, "окно под уже назначенной встречей предлагать нельзя").toBeUndefined();
  });

  it("следующая неделя показывает свои семь дней и свои встречи", async () => {
    const { group } = await mods();
    const { chat } = await makeGroup("Недели", "Амир");
    const { addDays, weekdayOf } = await import("@/core/timeutils");

    const now = await board(chat.slug!);
    const next = await board(chat.slug!, { week: 1 });

    expect(now.payload.week).toBe(0);
    expect(next.payload.week).toBe(1);
    expect(weekdayOf(next.state.weekStart)).toBe(0);
    expect(next.state.weekStart).toBe(addDays(now.state.weekStart, 7));
    expect(next.payload.days).toHaveLength(7);
    expect(next.payload.days[0].date).toBe(next.state.weekStart);
    // Варианты встречи на будущей неделе считаются с её понедельника.
    expect(next.payload.slotDays[0].date).toBe(next.state.weekStart);
    // Номер недели ограничен: мусор в адресе не уводит карту в никуда.
    expect(group.normalizeWeek("99")).toBe(0);
    expect(group.normalizeWeek("-1")).toBe(0);
    expect(group.normalizeWeek("2")).toBe(2);
  });
});

describe("своя занятость на общей карте", () => {
  it("клетки, где занят смотрящий, помечаются только для него", async () => {
    const { repo } = await mods();
    const { chat, user } = await makeGroup("Свой слой", "Амир");
    const guest = await repo.createWebUser({ fullName: "Асель", lang: "ru" });
    await repo.addMembership(chat.chatId, guest.userId);
    await repo.replaceWeeklySlots(
      user.userId,
      [0, 1, 2, 3, 4, 5, 6],
      [{ weekday: 0, start: 0, end: 1440 }],
      "web",
    );
    await repo.replaceWeeklySlots(guest.userId, [0, 1, 2, 3, 4, 5, 6], [], "web");

    const mine = await board(chat.slug!, { viewerId: user.userId });
    const theirs = await board(chat.slug!, { viewerId: guest.userId });
    const anonymous = await board(chat.slug!);

    expect(mine.payload.days[0].cells[0].mine).toBe(true);
    expect(theirs.payload.days[0].cells[0].mine).toBe(false);
    // Вторник свободен у обоих — помечать нечего.
    expect(mine.payload.days[1].cells[0].mine).toBe(false);
    // Без смотрящего (и у того, кто не заполнил расписание) слоя нет.
    expect(anonymous.payload.days[0].cells[0].mine).toBe(false);
  });
});

describe("кто должен прийти", () => {
  it("окна считаются для выбранных, а карта остаётся картой всей группы", async () => {
    const { repo, group } = await mods();
    const { chat, user } = await makeGroup("Кто придёт", "Амир");
    const { weekdayOf } = await import("@/core/timeutils");

    const guest = await repo.createWebUser({ fullName: "Асель", lang: "ru" });
    await repo.addMembership(chat.chatId, guest.userId);
    const late = await repo.createWebUser({ fullName: "Болат", lang: "ru" });
    await repo.addMembership(chat.chatId, late.userId);

    // Амир занят весь понедельник, Асель свободна, Болат расписание не заполнил.
    await repo.replaceWeeklySlots(user.userId, [0, 1, 2, 3, 4, 5, 6], [{ weekday: 0, start: 0, end: 1440 }], "web");
    await repo.replaceWeeklySlots(guest.userId, [0, 1, 2, 3, 4, 5, 6], [], "web");

    const all = await group.loadGroupState(chat, {});
    const onlyGuest = await group.loadGroupState(chat, { only: [guest.userId] });
    const allPayload = group.toBoardPayload(all, "ru");
    const guestPayload = group.toBoardPayload(onlyGuest, "ru");

    const monday = (payload: typeof allPayload) =>
      payload.slotDays.find((day) => weekdayOf(day.date) === 0)!;

    // Для всей группы в понедельник окон нет, для одной Асель — есть.
    expect(monday(allPayload).items).toHaveLength(0);
    expect(monday(guestPayload).items.length).toBeGreaterThan(0);
    expect(guestPayload.selectedTotal).toBe(1);

    // Карта при этом про всю группу: знаменатель прежний, Амир всё так же занят.
    expect(guestPayload.total).toBe(allPayload.total);
    expect(guestPayload.days[0].cells[0].missing).toContain("Амир");

    // В списке — все участники, и не заполнивший помечен.
    expect(guestPayload.people.map((person) => person.name).sort()).toEqual(["Амир", "Асель", "Болат"]);
    expect(guestPayload.people.find((person) => person.name === "Болат")!.filled).toBe(false);

    // Посторонние id отбрасываются: окна считаются как для всех.
    const stranger = await group.loadGroupState(chat, { only: [987654321] });
    expect(stranger.selected).toBeNull();
  });
});

describe("смена кода группы", () => {
  it("выдаёт новый код, старый перестаёт находиться", async () => {
    const { repo } = await mods();
    const { chat } = await makeGroup("Смена кода", "Амир");
    const before = chat.slug!;

    const after = await repo.regenerateSlug(chat.chatId);
    expect(after).not.toBe(before);
    expect(after).toMatch(/^[a-z0-9]{8}$/);

    expect(await repo.getChatBySlug(after)).not.toBeNull();
    expect(await repo.getChatBySlug(before), "старый код больше не работает").toBeNull();
    // Участники и встречи остаются на месте: меняется только код.
    expect((await repo.chatMembers(chat.chatId)).length).toBe(1);
  });
});

describe("код группы", () => {
  it("разбирает код как угодно набранным и отличает мусор", async () => {
    const { normalizeCode, formatCode } = await import("@/lib/invite");

    expect(normalizeCode("7kq4mzpd")).toBe("7kq4mzpd");
    expect(normalizeCode("  7KQ4 MZPD ")).toBe("7kq4mzpd");
    expect(normalizeCode("7kq4-mzpd")).toBe("7kq4mzpd");
    expect(normalizeCode("https://qairu.example/g/7kq4mzpd")).toBe("7kq4mzpd");
    expect(normalizeCode("https://qairu.example/g/7kq4mzpd/me")).toBe("7kq4mzpd");
    expect(normalizeCode("")).toBeNull();
    expect(normalizeCode("не код")).toBeNull();
    expect(normalizeCode("ab")).toBeNull();

    // Показываем код с пробелом посередине — так его проще продиктовать.
    expect(formatCode("7kq4mzpd")).toBe("7KQ4 MZPD");
  });

  it("новые коды не содержат символов, которые путают", async () => {
    const { repo } = await mods();
    const banned = /[01ilou]/;
    for (let i = 0; i < 50; i += 1) {
      expect(repo.newSlug()).not.toMatch(banned);
    }
  });
});

describe("после вступления в группу", () => {
  it("сперва спрашивает имя, потом ведёт в редактор или сразу в группу", async () => {
    const { repo } = await mods();
    const { afterJoinPath } = await import("@/lib/afterJoin");
    const { displayName } = await import("@/db/schema");
    const { chat } = await makeGroup("После вступления", "Староста");
    const slug = chat.slug!;

    const newcomer = await repo.createWebUser({ fullName: "amir_2005", lang: "ru" });
    await repo.addMembership(chat.chatId, newcomer.userId);

    // Имени ещё нет — первый шаг «как тебя подписать».
    expect(await afterJoinPath(slug, newcomer)).toBe(`/g/${slug}/welcome`);

    // Представился, расписания нет — в редактор.
    await repo.setRealName(newcomer.userId, "Амир Коваль");
    const named = (await repo.getUser(newcomer.userId))!;
    expect(displayName(named), "в группе видно его собственное имя, а не ник").toBe("Амир Коваль");
    expect(await afterJoinPath(slug, named)).toBe(`/g/${slug}/me`);

    // Расписание одно на все группы: уже заполнено — редактор не нужен.
    await repo.replaceWeeklySlots(newcomer.userId, [0, 1, 2, 3, 4, 5, 6], [], "web");
    expect(await afterJoinPath(slug, named)).toBe(`/g/${slug}?welcome=schedule`);
  });
});

describe("окна склеиваются в диапазоны", () => {
  it("подряд идущие варианты с одним составом — одна строка", async () => {
    const { group } = await mods();
    // Встреча на 30 минут, шаг полчаса: 8:00, 8:30, 9:00 — все свободны; 9:30 — без Болата.
    const runs = group.mergeRuns([
      { interval: [480, 510], freeIds: [1, 2, 3] },
      { interval: [510, 540], freeIds: [1, 2, 3] },
      { interval: [540, 570], freeIds: [3, 2, 1] },
      { interval: [570, 600], freeIds: [1, 2] },
      { interval: [720, 750], freeIds: [1, 2] },
    ]);
    expect(runs).toEqual([
      { interval: [480, 570], freeIds: [1, 2, 3], softIds: [] },
      { interval: [570, 600], freeIds: [1, 2], softIds: [] },
      // Разрыв во времени — отдельное окно, даже с тем же составом.
      { interval: [720, 750], freeIds: [1, 2], softIds: [] },
    ]);
  });

  it("не склеивает варианты, если кому-то неудобна только часть", async () => {
    const { group } = await mods();
    const runs = group.mergeRuns([
      { interval: [480, 510], freeIds: [1, 2], softIds: [] },
      { interval: [510, 540], freeIds: [1, 2], softIds: [2] },
    ]);
    expect(runs).toEqual([
      { interval: [480, 510], freeIds: [1, 2], softIds: [] },
      { interval: [510, 540], freeIds: [1, 2], softIds: [2] },
    ]);
  });
});

describe("новый семестр", () => {
  it("расписание, сохранённое до начала семестра, считается устаревшим", async () => {
    const { repo, group } = await mods();
    const { todayIn } = await import("@/core/timeutils");
    const { chat, user } = await makeGroup("Семестр", "Амир");
    await repo.replaceWeeklySlots(user.userId, [0, 1, 2, 3, 4, 5, 6], [], "web");

    const updated = await repo.scheduleUpdatedAt([user.userId]);
    const savedAt = updated.get(user.userId)!;
    expect(savedAt).toBeInstanceOf(Date);

    // Будущий семестр ещё ничего не делает устаревшим.
    expect(group.semesterCutoff({ ...chat, semesterStart: "2999-01-01" })).toBeNull();
    expect(group.semesterCutoff({ ...chat, semesterStart: null })).toBeNull();

    // Семестр начался сегодня: сохранённое сегодня — актуально, прошлогоднее — нет.
    const cutoff = group.semesterCutoff({ ...chat, semesterStart: todayIn("Asia/Almaty") });
    expect(cutoff).toBeInstanceOf(Date);
    expect(group.isOutdated(savedAt, cutoff)).toBe(false);
    expect(group.isOutdated(new Date("2020-01-01T00:00:00Z"), cutoff)).toBe(true);
    // Кто не заполнял вовсе — не «устарел», а просто не заполнил.
    expect(group.isOutdated(undefined, cutoff)).toBe(false);
  });
});

describe("подписка на календарь", () => {
  it("ссылка подписана: чужой id с чужой подписью не проходит", async () => {
    const { feedToken, verifyFeedToken, feedPath } = await import("@/lib/calendarFeed");
    const token = feedToken(-1000000000000222);
    expect(verifyFeedToken(token)).toBe(-1000000000000222);
    // Подменили id — подпись от другого человека не подходит.
    expect(verifyFeedToken(token.replace("-1000000000000222", "501"))).toBeNull();
    expect(verifyFeedToken("501_" + "A".repeat(24))).toBeNull();
    expect(verifyFeedToken("мусор")).toBeNull();
    expect(feedPath(501, "abcd2345")).toMatch(/^\/api\/calendar\/501_[A-Za-z0-9_-]{24}\.ics\?g=abcd2345$/);
  });

  it("лента — один календарь со всеми встречами и названием", async () => {
    const { buildFeed } = await import("@/core/calendar");
    const feed = buildFeed({
      name: "QairuCowork · ИС-21",
      events: [
        { uid: "meeting-1", summary: "Разбор задач", start: new Date("2026-09-24T08:10:00Z"), durationMin: 110 },
        { uid: "meeting-2", summary: "Проект", start: new Date("2026-09-25T09:00:00Z"), location: "Библиотека" },
      ],
    });
    expect(feed.startsWith("BEGIN:VCALENDAR")).toBe(true);
    expect(feed).toContain("X-WR-CALNAME:QairuCowork · ИС-21");
    expect(feed.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(feed).toContain("DTEND:20260924T100000Z");
    expect(feed).toContain("LOCATION:Библиотека");
    // RFC 5545: строки разделены CRLF.
    expect(feed).toContain(String.fromCharCode(13, 10) + "END:VCALENDAR");
  });
});

describe("повторяющиеся встречи на карте", () => {
  it("серия занимает свои клетки в каждой неделе до конца, разовая — только в своей", async () => {
    const { repo } = await mods();
    const { addDays, todayIn, weekdayOf, zonedWallToUtc } = await import("@/core/timeutils");
    const { chat, user } = await makeGroup("Серия", "Амир");
    const tz = "Asia/Almaty";
    const today = todayIn(tz);
    const monday = addDays(today, -weekdayOf(today));

    const series = await repo.createMeeting({
      chatId: chat.chatId,
      initiatorId: user.userId,
      place: "",
      whenText: "11:10–12:00",
      goal: "Консультация",
      invitees: [user.userId],
      whenStart: zonedWallToUtc(addDays(monday, 2), 670, tz),
      repeatUntil: addDays(monday, 2 + 14),
    });
    await repo.createMeeting({
      chatId: chat.chatId,
      initiatorId: user.userId,
      place: "",
      whenText: "разово",
      goal: "Разовая",
      invitees: [user.userId],
      whenStart: zonedWallToUtc(addDays(monday, 3), 780, tz),
    });

    const titles = async (week: number) =>
      (await board(chat.slug!, { week })).payload.meetings.map((span) => `${span.title}@${span.date}`);

    expect(await titles(0)).toEqual(
      expect.arrayContaining([`Консультация@${addDays(monday, 2)}`, `Разовая@${addDays(monday, 3)}`]),
    );
    expect(await titles(1)).toEqual([`Консультация@${addDays(monday, 9)}`]);
    expect(await titles(2)).toEqual([`Консультация@${addDays(monday, 16)}`]);
    // Серия кончилась — на четвёртой неделе её нет.
    expect(await titles(3)).toEqual([]);
    // Каждый повтор — те же 11:10–12:00.
    const week1 = (await board(chat.slug!, { week: 1 })).payload.meetings[0];
    expect([week1.start, week1.end]).toEqual([670, 720]);
    expect(series.repeatUntil).toBe(addDays(monday, 16));
  });
});
