/**
 * Проверка слоя данных на настоящем Postgres.
 *
 * Движок поднимается в процессе через PGlite: миграция накатывается тем же
 * SQL-файлом, что уедет в Supabase, поэтому здесь ловятся ошибки, которых не
 * видно ни в typecheck, ни в сборке, — несовпадение схемы, кривой ON CONFLICT,
 * неверный `make_interval` в условии напоминаний.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { startTestDb } from "./support/db";

beforeAll(async () => {
  // Подменяем синглтон до первого импорта repo: getDb() читает именно его.
  await startTestDb();
});

async function repo() {
  return import("@/db/repo");
}

describe("пользователи и чаты", () => {
  it("upsert обновляет username и не затирает имя пустым", async () => {
    const r = await repo();
    await r.upsertUser({ userId: 101, username: "asel", fullName: "Асель", lang: "ru" });
    await r.upsertUser({ userId: 101, username: "asel_new", fullName: "", lang: null });

    const user = await r.getUser(101);
    expect(user?.username).toBe("asel_new");
    expect(user?.fullName).toBe("Асель"); // пустое имя не затирает прежнее
    expect(user?.lang).toBe("ru");
  });

  it("upsertChat не сбрасывает настройки при повторном вызове", async () => {
    const r = await repo();
    await r.upsertChat(-1001, "ИС-21");
    await r.updateChat(-1001, { minSlotMin: 45, tz: "Europe/Moscow" });
    await r.upsertChat(-1001, "");

    const chat = await r.getChat(-1001);
    expect(chat?.title).toBe("ИС-21");
    expect(chat?.minSlotMin).toBe(45);
    expect(chat?.tz).toBe("Europe/Moscow");
  });

  it("членство добавляется один раз", async () => {
    const r = await repo();
    await r.upsertUser({ userId: 102, username: null, fullName: "Нурбек" });
    expect(await r.addMembership(-1001, 101)).toBe(true);
    expect(await r.addMembership(-1001, 101)).toBe(false);
    await r.addMembership(-1001, 102);

    expect(await r.isMember(-1001, 101)).toBe(true);
    expect(await r.isMember(-1001, 999)).toBe(false);

    const members = await r.chatMembers(-1001);
    expect(members.map((m) => m.userId).sort()).toEqual([101, 102]);

    await r.removeMembership(-1001, 102);
    expect(await r.isMember(-1001, 102)).toBe(false);
    await r.addMembership(-1001, 102);
  });

  it("username ищется без учёта регистра", async () => {
    const r = await repo();
    expect((await r.findUserByUsername("@ASEL_NEW"))?.userId).toBe(101);
    expect(await r.findUserByUsername("никого")).toBeNull();
  });

  it("синтетические id веб-сущностей лежат в безопасном диапазоне", async () => {
    const r = await repo();
    for (let i = 0; i < 20; i += 1) {
      const id = r.newWebId();
      expect(id).toBeLessThan(-(10 ** 15));
      expect(Number.isSafeInteger(id)).toBe(true);
    }
  });
});

describe("расписание", () => {
  it("замена недельных слотов не трогает разовые", async () => {
    const r = await repo();
    await r.addDatedSlot({
      userId: 101,
      day: "2026-09-12",
      start: 840,
      end: 960,
      label: "экзамен",
      kind: "exam",
    });
    await r.replaceWeeklySlots(
      101,
      [0, 1, 2, 3, 4, 5, 6],
      [
        { weekday: 0, start: 540, end: 630, label: "Матан" },
        { weekday: 0, start: 780, end: 870, label: "История", parity: 1 },
      ],
      "web",
    );
    await r.replaceWeeklySlots(101, [0], [{ weekday: 0, start: 600, end: 700 }], "web");

    const slots = await r.getSlots(101);
    const weekly = slots.filter((slot) => slot.specificDate === null && slot.dateFrom === null);
    expect(weekly).toHaveLength(1);
    expect([weekly[0].startMin, weekly[0].endMin]).toEqual([600, 700]);
    expect(slots.some((slot) => slot.specificDate === "2026-09-12")).toBe(true);
  });

  it("отметка «заполнил» ставится и снимается", async () => {
    const r = await repo();
    expect(await r.isFilled(101)).toBe(true);
    expect(await r.filledIds([101, 102])).toEqual(new Set([101]));
    await r.clearSchedule(101);
    expect(await r.isFilled(101)).toBe(false);
    expect(await r.getSlots(101)).toEqual([]);
  });

  it("собирает PersonSchedule всех четырёх видов занятости", async () => {
    const r = await repo();
    await r.replaceWeeklySlots(
      101,
      [0],
      [
        { weekday: 0, start: 540, end: 630 },
        { weekday: 0, start: 780, end: 870, parity: 0 },
      ],
      "web",
    );
    await r.addDatedSlot({ userId: 101, day: "2026-09-12", start: 840, end: 960 });
    await r.addRangeSlot({
      userId: 101,
      dateFrom: "2026-09-15",
      dateTo: "2026-09-20",
      start: 0,
      end: 1440,
    });

    const members = await r.chatMembers(-1001);
    const people = await r.buildPersonSchedules(members);
    const asel = people.find((person) => person.userId === 101)!;

    expect(asel.weekly.get(0)).toEqual([[540, 630]]);
    expect(asel.weeklyParity.get(0)?.get(0)).toEqual([[780, 870]]);
    expect(asel.dated.get("2026-09-12")).toEqual([[840, 960]]);
    expect(asel.ranges).toEqual([
      { dateFrom: "2026-09-15", dateTo: "2026-09-20", start: 0, end: 1440 },
    ]);
    // Нурбек ничего не заполнял — он не участвует в расчёте, но виден в списке.
    expect(people.find((person) => person.userId === 102)?.hasData).toBe(false);
  });

  it("«неудобно» хранится отдельно и не стирается импортом", async () => {
    const r = await repo();
    await r.upsertUser({ userId: 131, username: null, fullName: "Дана", lang: "ru" });
    // Редактор сохраняет и пары, и отметки «неудобно».
    await r.replaceWeeklySlots(
      131,
      [0],
      [
        { weekday: 0, start: 540, end: 630, kind: "class" },
        { weekday: 0, start: 720, end: 840, kind: r.SOFT_KIND },
      ],
      "web",
      undefined,
      { withSoft: true },
    );
    // Импорт текстом приносит только пары и не должен трогать «неудобно».
    await r.replaceWeeklySlots(131, [0], [{ weekday: 0, start: 600, end: 690, kind: "class" }], "import");

    const [person] = await r.buildPersonSchedules([(await r.getUser(131))!]);
    expect(person.weekly.get(0)).toEqual([[600, 690]]);
    expect(person.softWeekly.get(0)).toEqual([[720, 840]]);
    // «Неудобно» — не занятость.
    expect(person.busyOn("2026-09-07")).toEqual([[600, 690]]);
  });

  it("удаляет только разовые записи, оставляя неделю", async () => {
    const r = await repo();
    const removed = await r.deleteDatedSlots(101);
    expect(removed).toBe(2);
    const slots = await r.getSlots(101);
    expect(slots).toHaveLength(2);
    expect(slots.every((slot) => slot.weekday !== null)).toBe(true);
  });
});

describe("веб-группы и сессии", () => {
  it("создаёт группу со слагом и пускает по токену", async () => {
    const r = await repo();
    const chat = await r.createWebChat({ title: "Проектная команда", lang: "kk" });
    expect(chat.slug).toMatch(/^[a-z0-9]{8}$/);
    expect(chat.origin).toBe("web");
    expect(await r.getChatBySlug(chat.slug!)).toMatchObject({ chatId: chat.chatId });

    const user = await r.createWebUser({ fullName: "Амир", lang: "kk" });
    expect(user.isWeb).toBe(true);
    const token = await r.issueWebSession(user.userId);

    expect((await r.userByWebToken(token))?.userId).toBe(user.userId);
    expect(await r.userByWebToken("подделка")).toBeNull();
  });

  it("выдаёт слаг телеграм-чату по требованию", async () => {
    const r = await repo();
    const chat = await r.getChat(-1001);
    const slug = await r.ensureSlug(chat!);
    expect(slug).toMatch(/^[a-z0-9]{8}$/);
    // Повторный вызов возвращает тот же слаг, а не новый.
    expect(await r.ensureSlug((await r.getChat(-1001))!)).toBe(slug);
  });

  it("транзакция откатывает всё при ошибке", async () => {
    const r = await repo();
    const before = (await r.userChats(101)).length;
    await expect(
      r.transaction(async (tx) => {
        await r.createWebUser({ fullName: "Призрак" }, tx);
        throw new Error("сбой посреди операции");
      }),
    ).rejects.toThrow("сбой посреди операции");
    expect((await r.userChats(101)).length).toBe(before);
  });
});

describe("встречи", () => {
  it("создаётся, собирает голоса и переживает смену ответа", async () => {
    const r = await repo();
    const meeting = await r.createMeeting({
      chatId: -1001,
      initiatorId: 101,
      place: "Библиотека",
      whenText: "среда, 15:00–16:30",
      goal: "Разбор задач",
      invitees: [101, 102],
      whenStart: new Date("2026-09-16T10:00:00.000Z"),
    });

    expect(r.inviteeIds(meeting)).toEqual([101, 102]);
    // Момент времени обязан пережить запись в БД без сдвига.
    expect((await r.getMeeting(meeting.id))?.whenStart?.toISOString()).toBe(
      "2026-09-16T10:00:00.000Z",
    );

    await r.setResponse({ meetingId: meeting.id, userId: 101, answer: "yes" });
    await r.setResponse({ meetingId: meeting.id, userId: 102, answer: "no" });
    await r.setResponse({
      meetingId: meeting.id,
      userId: 102,
      answer: "change",
      comment: "лучше в четверг",
    });

    const responses = await r.meetingResponsesFor(meeting.id);
    expect(responses).toHaveLength(2);
    const nurbek = responses.find((row) => row.userId === 102)!;
    expect(nurbek.answer).toBe("change");
    expect(nurbek.comment).toBe("лучше в четверг");

    const byMeeting = await r.meetingResponsesForMany([meeting.id]);
    expect(byMeeting.get(meeting.id)).toHaveLength(2);
    expect((await r.chatMeetings(-1001))[0].id).toBe(meeting.id);
  });

  it("напоминание выбирается по порогу чата и отправляется один раз", async () => {
    const r = await repo();
    await r.updateChat(-1001, { reminderMin: 30 });
    const start = new Date("2026-10-01T12:00:00.000Z");
    const meeting = await r.createMeeting({
      chatId: -1001,
      initiatorId: 101,
      place: "",
      whenText: "",
      goal: "",
      invitees: [101],
      whenStart: start,
    });

    const tooEarly = new Date(start.getTime() - 45 * 60_000);
    const inWindow = new Date(start.getTime() - 20 * 60_000);
    const tooLate = new Date(start.getTime() + 60_000);

    const ids = async (now: Date) =>
      (await r.meetingsDueForReminder(now)).map((row) => row.meeting.id);

    expect(await ids(tooEarly)).not.toContain(meeting.id);
    expect(await ids(inWindow)).toContain(meeting.id);
    expect(await ids(tooLate)).not.toContain(meeting.id); // встреча уже началась

    await r.updateMeeting(meeting.id, { reminderSent: true });
    expect(await ids(inWindow)).not.toContain(meeting.id);

    // Отменённая встреча тоже выпадает из выборки.
    await r.updateMeeting(meeting.id, { reminderSent: false, status: "cancelled" });
    expect(await ids(inWindow)).not.toContain(meeting.id);
  });
});

describe("состояние диалогов бота", () => {
  it("пишется, перезаписывается и удаляется", async () => {
    const r = await repo();
    expect(await r.getBotState("mtg:1:2")).toBeNull();
    await r.setBotState("mtg:1:2", { step: "place" });
    await r.setBotState("mtg:1:2", { step: "time", promptId: 7 });
    expect(await r.getBotState<{ step: string; promptId: number }>("mtg:1:2")).toEqual({
      step: "time",
      promptId: 7,
    });
    await r.deleteBotState("mtg:1:2");
    expect(await r.getBotState("mtg:1:2")).toBeNull();
  });
});

describe("вкладка «Встречи»", () => {
  it("давняя предстоящая встреча не теряется за новыми прошедшими, в архиве — 10 свежих", async () => {
    const r = await repo();
    const { meetingIsOver } = await import("@/core/recurrence");
    const { addDays, todayIn } = await import("@/core/timeutils");
    const chatId = -2002;
    await r.upsertChat(chatId, "Архив");
    const now = new Date();
    const today = todayIn("Asia/Almaty", now);
    const day = 86_400_000;
    const base = { chatId, initiatorId: 101, place: "", whenText: "", goal: "", invitees: [101] };

    // Первой создана встреча через месяц, после неё — двенадцать прошедших.
    const ahead = await r.createMeeting({ ...base, goal: "через месяц", whenStart: new Date(now.getTime() + 30 * day) });
    for (let n = 1; n <= 12; n += 1) {
      await r.createMeeting({ ...base, goal: `прошла ${n}`, whenStart: new Date(now.getTime() - n * day) });
    }
    // Идущая серия, отменённая встреча, встречи без точного времени — свежая и давняя.
    const series = await r.createMeeting({
      ...base,
      goal: "серия",
      whenStart: new Date(now.getTime() - 20 * day),
      repeatUntil: addDays(today, 60),
    });
    const cancelled = await r.createMeeting({ ...base, goal: "отменена", whenStart: new Date(now.getTime() + 5 * day) });
    await r.updateMeeting(cancelled.id, { status: "cancelled" });
    const fresh = await r.createMeeting({ ...base, goal: "когда-нибудь" });
    const stale = await r.createMeeting({ ...base, goal: "давно без времени" });
    await r.updateMeeting(stale.id, { createdAt: new Date(now.getTime() - 20 * day) });

    const rows = await r.chatMeetingsForTab(chatId, now, today);
    const upcoming = rows.filter((meeting) => !meetingIsOver(meeting, now, today));
    const archived = rows.filter((meeting) => meetingIsOver(meeting, now, today));

    // SQL и meetingIsOver согласны: предстоящие — все и только они.
    expect(upcoming.map((meeting) => meeting.id).sort()).toEqual([ahead.id, series.id, fresh.id].sort());
    expect(archived).toHaveLength(10);
    // Архив — от свежих к старым: отменённая (её время впереди), потом вчерашняя.
    expect(archived.slice(0, 3).map((meeting) => meeting.goal)).toEqual(["отменена", "прошла 1", "прошла 2"]);
    expect(archived.map((meeting) => meeting.id)).not.toContain(stale.id);
  });
});
