/**
 * Встреча вдвоём с другом: кнопки выбора времени (чистые функции) и вся
 * цепочка на настоящем Postgres и заглушке Telegram — назначить с карточки
 * друга, карточка с кнопками у друга в личке, ответы с сайта и из бота,
 * отмена, напоминание, ожидание на сайте, удаление из друзей и блокировка.
 * Каждый запрет — отдельный тест: чужой человек, чужая встреча, время в
 * прошлом, лимит в сутки.
 */

import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { TgUpdate } from "@/bot/api";
import * as plan from "@/core/pairPlan";
import { addDays, todayIn, zonedWallToUtc } from "@/core/timeutils";
import type { User } from "@/db/schema";
import { startTestDb } from "./support/db";
import { installTelegramStub, type TelegramStub } from "./support/telegram";

const TZ = "Asia/Almaty";

// --------------------------------------------------------------------------
// Кнопки выбора
// --------------------------------------------------------------------------

describe("выбор времени встречи вдвоём", () => {
  it("начала: само начало окна, дальше ровные :00 и :30, пока встреча влезает", () => {
    expect(plan.startOptions([[650, 780]], 60)).toEqual([650, 660, 690, 720]);
    // Окно короче встречи — кнопок нет; два окна — по порядку, без повторов.
    expect(plan.startOptions([[600, 630]], 60)).toEqual([]);
    expect(plan.startOptions([[600, 690], [840, 900]], 30)).toEqual([600, 630, 660, 840, 870]);
  });

  it("общее время неизвестно: весь день 8–22, сегодня — не раньше «сейчас»", () => {
    expect(plan.openWindows("2026-10-23", "2026-10-22", 900)).toEqual([[480, 1320]]);
    expect(plan.openWindows("2026-10-22", "2026-10-22", 905)).toEqual([[930, 1320]]);
    expect(plan.openWindows("2026-10-22", "2026-10-22", 1330)).toEqual([]);
  });

  it("готовые варианты — самое раннее начало, по одному на день", () => {
    const days = [
      { day: "2026-10-22", windows: [[600, 640]] as [number, number][] },
      { day: "2026-10-23", windows: [[900, 1000], [1100, 1300]] as [number, number][] },
      { day: "2026-10-24", windows: [[480, 600]] as [number, number][] },
      { day: "2026-10-25", windows: [[480, 600]] as [number, number][] },
    ];
    expect(plan.suggestStarts(days, 60)).toEqual([
      { day: "2026-10-23", start: 900 },
      { day: "2026-10-24", start: 480 },
      { day: "2026-10-25", start: 480 },
    ]);
  });

  it("время уже назначенной встречи с этим другом из выбора выпадает", () => {
    expect(plan.withoutBooked([[480, 1320]], [[900, 960]])).toEqual([
      [480, 900],
      [960, 1320],
    ]);
    expect(plan.withoutBooked([[1260, 1320]], [[1260, 1320]])).toEqual([]);
    expect(plan.withoutBooked([[600, 700]], [])).toEqual([[600, 700]]);
  });

  it("время из формы — только машинный вид «день T чч:мм | минуты»", () => {
    expect(plan.parsePickedWhen("2026-10-28T15:00|60")).toEqual({ day: "2026-10-28", start: 900, duration: 60 });
    expect(plan.parsePickedWhen("среда 15:00")).toBeNull();
    expect(plan.parsePickedWhen("2026-10-28T25:00|60")).toBeNull();
    expect(plan.parsePickedWhen("2026-10-28T23:30|60")).toBeNull(); // за полночь
    expect(plan.parsePickedWhen("2026-02-30T10:00|60")).toBeNull();
  });

  it("второй человек — другу создатель, создателю друг, у встречи группы — никто", () => {
    expect(plan.pairPartner({ initiatorId: 1, withUser: 2 }, 1)).toBe(2);
    expect(plan.pairPartner({ initiatorId: 1, withUser: 2 }, 2)).toBe(1);
    expect(plan.pairPartner({ initiatorId: 1, withUser: null }, 1)).toBeNull();
    expect(plan.planDays("2026-10-30")).toHaveLength(14);
    expect(plan.planDays("2026-10-30")[13]).toBe("2026-11-12");
  });
});

// --------------------------------------------------------------------------
// Вся цепочка
// --------------------------------------------------------------------------

let db: PGlite;
let stub: TelegramStub;

async function mods() {
  return {
    repo: await import("@/db/repo"),
    friends: await import("@/lib/friends"),
    pair: await import("@/lib/pairMeetings"),
    router: await import("@/bot/router"),
    meeting: await import("@/bot/handlers/meeting"),
  };
}

async function person(id: number, username: string, name: string): Promise<User> {
  await db.query("insert into users (user_id, username, full_name, lang) values ($1, $2, $3, 'ru')", [id, username, name]);
  return (await (await mods()).repo.getUser(id))!;
}

async function friendsPair(a: number, b: number, names: [string, string]): Promise<[User, User]> {
  const one = await person(a, `pm_${a}`, names[0]);
  const two = await person(b, `pm_${b}`, names[1]);
  await (await mods()).repo.addFriendship(a, b);
  return [one, two];
}

/** «Послезавтра в 15:00» по Алматы — всегда в будущем и внутри двух недель плана. */
function soon(daysAhead = 2, start = 15 * 60, duration = 60) {
  const day = addDays(todayIn(TZ), daysAhead);
  return { day, when: `${day}T${String(Math.floor(start / 60)).padStart(2, "0")}:${String(start % 60).padStart(2, "0")}|${duration}` };
}

const input = (when: string, extra: Partial<{ goal: string; place: string; repeat: boolean; repeatUntil: string }> = {}) => ({
  when,
  goal: extra.goal ?? "Обсудить проект",
  place: extra.place ?? "Библиотека",
  repeat: extra.repeat ?? false,
  repeatUntil: extra.repeatUntil ?? "",
});

const dmsTo = (userId: number) => stub.of("sendMessage").filter((call) => call.payload.chat_id === userId);

/** Нажатие кнопки в личке с ботом, на сообщении `messageId`. */
function press(who: User, data: string, messageId: number): TgUpdate {
  return {
    update_id: 1,
    callback_query: {
      id: `cb-${data}`,
      from: { id: who.userId, is_bot: false, first_name: who.fullName, username: who.username ?? undefined },
      data,
      message: { message_id: messageId, chat: { id: who.userId, type: "private" }, date: 0 },
    },
  } as TgUpdate;
}

beforeAll(async () => {
  process.env.BOT_TOKEN = "123456:AAHtestTOKENtestTOKENtestTOKENtestTO";
  process.env.NEXT_PUBLIC_SITE_URL = "https://qairu.example";
  stub = installTelegramStub();
  db = await startTestDb();
});

beforeEach(() => {
  stub.reset();
  stub.blockedIds = [];
});

describe("встреча вдвоём: назначить", () => {
  it("другу — карточка с теми же кнопками, что у встреч группы, и «Открыть»", async () => {
    const { pair, repo } = await mods();
    const [amir, asel] = await friendsPair(8101, 8102, ["Амир", "Асель"]);
    const { day, when } = soon();

    const outcome = await pair.createPairMeeting(amir, asel.userId, input(when));
    expect(outcome.code).toBe("meeting_sent");
    if (!("meeting" in outcome)) return;
    const meeting = (await repo.getMeeting(outcome.meeting.id))!;
    expect(meeting.chatId).toBeNull();
    expect(meeting.withUser).toBe(asel.userId);
    expect(repo.inviteeIds(meeting)).toEqual([amir.userId, asel.userId]);
    expect(meeting.whenStart?.toISOString()).toBe(zonedWallToUtc(day, 900, TZ).toISOString());
    expect(meeting.durationMin).toBe(60);
    // Создатель сразу «приду»; карточку у друга запомнили — её перерисуют ответы.
    expect((await repo.meetingResponsesFor(meeting.id)).map((row) => [row.userId, row.answer])).toEqual([[amir.userId, "yes"]]);
    expect(meeting.chatMessageId).not.toBeNull();

    const [card] = dmsTo(asel.userId);
    expect(card).toBeDefined();
    const text = String(card!.payload.text);
    expect(text).toContain("зовёт тебя на встречу вдвоём");
    expect(text).toContain("Встреча вдвоём");
    expect(text).toContain("Обсудить проект");
    expect(text).toContain("15:00–16:00");
    const markup = JSON.stringify(card!.payload.reply_markup);
    for (const data of [`vote:${meeting.id}:yes`, `vote:${meeting.id}:no`, `vote:${meeting.id}:maybe`, `vote:${meeting.id}:change`, `card:ics:${meeting.id}`]) {
      expect(markup).toContain(data);
    }
    expect(markup).toContain(`/friends/${amir.userId}`);
    // Создателю в Telegram ничего не шлём — он на сайте и только что нажал кнопку.
    expect(dmsTo(amir.userId)).toHaveLength(0);
  });

  it("не друг, время в прошлом, за пределами двух недель и вне 8–22 — нельзя", async () => {
    const { pair } = await mods();
    const [amir, asel] = await friendsPair(8111, 8112, ["Амир", "Асель"]);
    const stranger = await person(8113, "pm_stranger", "Чужой");

    expect((await pair.createPairMeeting(amir, stranger.userId, input(soon().when))).code).toBe("not_friend");
    expect((await pair.createPairMeeting(amir, 999_999, input(soon().when))).code).toBe("not_friend");
    expect((await pair.createPairMeeting(amir, asel.userId, input(soon(-1).when))).code).toBe("meeting_time");
    expect((await pair.createPairMeeting(amir, asel.userId, input(soon(20).when))).code).toBe("meeting_time");
    expect((await pair.createPairMeeting(amir, asel.userId, input(soon(2, 21 * 60 + 30).when))).code).toBe("meeting_time");
    expect((await pair.createPairMeeting(amir, asel.userId, input("завтра вечером"))).code).toBe("meeting_time");
    expect(stub.of("sendMessage")).toHaveLength(0);
  });

  it("бот не может написать другу — встреча ждёт его в «Друзьях», счётчик растёт", async () => {
    const { pair, repo } = await mods();
    const [amir, asel] = await friendsPair(8121, 8122, ["Амир", "Асель"]);
    stub.blockedIds = [asel.userId];

    const outcome = await pair.createPairMeeting(amir, asel.userId, input(soon().when));
    expect(outcome.code).toBe("meeting_site");
    const waiting = await repo.pendingPairInvites(asel.userId, new Date());
    expect(waiting.map((meeting) => meeting.initiatorId)).toEqual([amir.userId]);
    expect(await repo.friendBadge(asel.userId, new Date())).toBe(1);
    // Ответил — больше не ждёт.
    expect(await pair.answerPairMeeting(asel, waiting[0]!.id, "maybe", "")).toBe("answered");
    expect(await repo.pendingPairInvites(asel.userId, new Date())).toHaveLength(0);
    expect(await repo.friendBadge(asel.userId, new Date())).toBe(0);
  });

  it("повтор каждую неделю — не дальше года", async () => {
    const { pair, repo } = await mods();
    const [amir, asel] = await friendsPair(8131, 8132, ["Амир", "Асель"]);
    const { day, when } = soon(3);
    const outcome = await pair.createPairMeeting(amir, asel.userId, input(when, { repeat: true, repeatUntil: addDays(day, 800) }));
    if (!("meeting" in outcome)) throw new Error(outcome.code);
    expect((await repo.getMeeting(outcome.meeting.id))!.repeatUntil).toBe(addDays(day, 366));
  });

  it("не больше 20 встреч вдвоём в сутки", async () => {
    const { pair } = await mods();
    const [amir, asel] = await friendsPair(8141, 8142, ["Амир", "Асель"]);
    for (let n = 0; n < 20; n += 1) {
      expect((await pair.createPairMeeting(amir, asel.userId, input(soon(2 + (n % 10), 9 * 60 + 30 * Math.floor(n / 10)).when))).code).toBe(
        "meeting_sent",
      );
    }
    expect((await pair.createPairMeeting(amir, asel.userId, input(soon(5, 18 * 60).when))).code).toBe("throttled");
  });
});

describe("встреча вдвоём: ответы и отмена", () => {
  it("друг отвечает кнопкой в боте — создателю приходит «придёт», карточка перерисована", async () => {
    const { pair, repo, router } = await mods();
    const [amir, asel] = await friendsPair(8201, 8202, ["Амир", "Асель"]);
    const outcome = await pair.createPairMeeting(amir, asel.userId, input(soon().when));
    if (!("meeting" in outcome)) throw new Error(outcome.code);
    const meeting = (await repo.getMeeting(outcome.meeting.id))!;
    stub.reset();

    await router.handleUpdate(press(asel, `vote:${meeting.id}:yes`, meeting.chatMessageId!));
    expect((await repo.meetingResponsesFor(meeting.id)).find((row) => row.userId === asel.userId)?.answer).toBe("yes");
    const [note] = dmsTo(amir.userId);
    expect(String(note?.payload.text)).toContain("Асель придёт на встречу «Обсудить проект»");
    expect(JSON.stringify(note?.payload.reply_markup)).toContain(`/friends/${asel.userId}`);
    // Перерисована ровно та карточка, на которой нажали, — второй правки той же карточки нет.
    const edits = stub.of("editMessageText");
    expect(edits).toHaveLength(1);
    expect(edits[0]!.payload.chat_id).toBe(asel.userId);
    expect(String(edits[0]!.payload.text)).toContain("Придут (2)");
  });

  it("ответ с сайта перерисовывает карточку у друга; «предложить другое» — без текста нельзя", async () => {
    const { pair, repo } = await mods();
    const [amir, asel] = await friendsPair(8211, 8212, ["Амир", "Асель"]);
    const outcome = await pair.createPairMeeting(amir, asel.userId, input(soon().when));
    if (!("meeting" in outcome)) throw new Error(outcome.code);
    const meeting = (await repo.getMeeting(outcome.meeting.id))!;
    stub.reset();

    expect(await pair.answerPairMeeting(asel, meeting.id, "change", "  ")).toBe("empty_comment");
    expect(await pair.answerPairMeeting(asel, meeting.id, "change", "Давай в 17:00")).toBe("answered");
    const edit = stub.last("editMessageText");
    expect(edit?.payload.chat_id).toBe(asel.userId);
    expect(edit?.payload.message_id).toBe(meeting.chatMessageId);
    expect(String(dmsTo(amir.userId)[0]?.payload.text)).toContain("Давай в 17:00");
    expect(await pair.answerPairMeeting(asel, meeting.id, "nonsense", "")).toBe("gone");
  });

  it("чужой не ответит и не отменит; отменяет только создатель — другу сообщение", async () => {
    const { pair, repo, router } = await mods();
    const [amir, asel] = await friendsPair(8221, 8222, ["Амир", "Асель"]);
    const stranger = await person(8223, "pm_stranger2", "Чужой");
    const outcome = await pair.createPairMeeting(amir, asel.userId, input(soon().when));
    if (!("meeting" in outcome)) throw new Error(outcome.code);
    const meeting = (await repo.getMeeting(outcome.meeting.id))!;
    stub.reset();

    expect(await pair.answerPairMeeting(stranger, meeting.id, "yes", "")).toBe("gone");
    expect(await pair.cancelPairMeeting(stranger, meeting.id)).toBe("gone");
    expect(await pair.cancelPairMeeting(asel, meeting.id)).toBe("gone");
    expect(await pair.pairMeetingWith(stranger, amir.userId, meeting.id)).toBeNull();
    expect((await pair.pairMeetingWith(asel, amir.userId, meeting.id))?.id).toBe(meeting.id);

    // Друг жмёт «Отменить» в боте — подсказка про «Не смогу», встреча жива.
    await router.handleUpdate(press(asel, `card:cancel:${meeting.id}`, meeting.chatMessageId!));
    expect(String(stub.last("answerCallbackQuery")?.payload.text)).toContain("Не смогу");
    expect((await repo.getMeeting(meeting.id))!.status).toBe("open");

    expect(await pair.cancelPairMeeting(amir, meeting.id)).toBe("meeting_cancelled");
    expect((await repo.getMeeting(meeting.id))!.status).toBe("cancelled");
    expect(String(dmsTo(asel.userId).at(-1)?.payload.text)).toContain("Встреча «Обсудить проект»");
    expect(String(dmsTo(asel.userId).at(-1)?.payload.text)).toContain("отменена — <b>Амир</b>");
    expect(String(stub.last("editMessageText")?.payload.text)).toContain("Встреча отменена");
    // Отменённая — ни ответить, ни отменить второй раз.
    expect(await pair.answerPairMeeting(asel, meeting.id, "yes", "")).toBe("gone");
    expect(await pair.cancelPairMeeting(amir, meeting.id)).toBe("gone");
  });

  it("«Напомнить» — другу снова карточка, второй раз за 10 минут нельзя", async () => {
    const { pair, repo } = await mods();
    const [amir, asel] = await friendsPair(8231, 8232, ["Амир", "Асель"]);
    const outcome = await pair.createPairMeeting(amir, asel.userId, input(soon().when));
    if (!("meeting" in outcome)) throw new Error(outcome.code);
    stub.reset();
    expect(await pair.pingPairMeeting(asel, outcome.meeting.id)).toBe("gone");
    expect(await pair.pingPairMeeting(amir, outcome.meeting.id)).toBe("pinged");
    const ping = dmsTo(asel.userId)[0];
    expect(String(ping?.payload.text)).toContain("ждёт твоего ответа");
    expect(JSON.stringify(ping?.payload.reply_markup)).toContain(`vote:${outcome.meeting.id}:yes`);
    expect(await pair.pingPairMeeting(amir, outcome.meeting.id)).toBe("throttled");
    expect((await repo.getMeeting(outcome.meeting.id))!.status).toBe("open");
  });

  it("удаление из друзей и блокировка отменяют открытые встречи двоих", async () => {
    const { pair, repo, friends } = await mods();
    const [amir, asel] = await friendsPair(8241, 8242, ["Амир", "Асель"]);
    const first = await pair.createPairMeeting(amir, asel.userId, input(soon().when));
    if (!("meeting" in first)) throw new Error(first.code);
    expect(await friends.removeFriend(asel, amir.userId)).toBe("removed");
    expect((await repo.getMeeting(first.meeting.id))!.status).toBe("cancelled");
    // Уже не друзья — новую не назначить.
    expect((await pair.createPairMeeting(amir, asel.userId, input(soon().when))).code).toBe("not_friend");

    await repo.addFriendship(amir.userId, asel.userId);
    const second = await pair.createPairMeeting(asel, amir.userId, input(soon(4).when));
    if (!("meeting" in second)) throw new Error(second.code);
    expect(await friends.blockUser(amir, asel.userId)).toBe("blocked_done");
    expect((await repo.getMeeting(second.meeting.id))!.status).toBe("cancelled");
  });
});

describe("встреча вдвоём: напоминание и где её видно", () => {
  it("за 30 минут — обоим в личку, с кем и когда; второй прогон не дублирует", async () => {
    const { pair, repo, meeting: handlers } = await mods();
    const [amir, asel] = await friendsPair(8301, 8302, ["Амир", "Асель"]);
    const outcome = await pair.createPairMeeting(amir, asel.userId, input(soon().when));
    if (!("meeting" in outcome)) throw new Error(outcome.code);
    const meeting = (await repo.getMeeting(outcome.meeting.id))!;
    await pair.answerPairMeeting(asel, meeting.id, "yes", "");
    stub.reset();

    const at = new Date(meeting.whenStart!.getTime() - 20 * 60_000);
    expect(await handlers.sendDueReminders(at)).toBeGreaterThanOrEqual(1);
    const toAmir = String(dmsTo(amir.userId)[0]?.payload.text);
    const toAsel = String(dmsTo(asel.userId)[0]?.payload.text);
    expect(toAmir).toContain("встреча вдвоём</b> · Асель");
    expect(toAsel).toContain("встреча вдвоём</b> · Амир");
    expect(toAsel).toContain("15:00–16:00");
    stub.reset();
    await handlers.sendDueReminders(new Date(at.getTime() + 60_000));
    expect(dmsTo(amir.userId)).toHaveLength(0);
    expect(dmsTo(asel.userId)).toHaveLength(0);
  });

  it("на карточке друга — у обоих; под группами и в вопросе «был ли ты» — нет", async () => {
    const { pair, repo } = await mods();
    const [amir, asel] = await friendsPair(8311, 8312, ["Амир", "Асель"]);
    const outcome = await pair.createPairMeeting(amir, asel.userId, input(soon().when));
    if (!("meeting" in outcome)) throw new Error(outcome.code);
    const now = new Date();
    const today = todayIn(TZ, now);
    for (const [a, b] of [
      [amir.userId, asel.userId],
      [asel.userId, amir.userId],
    ] as const) {
      expect((await repo.pairMeetingsBetween(a, b, now, today)).upcoming.map((meeting) => meeting.id)).toEqual([outcome.meeting.id]);
      expect((await repo.pairMeetingsOf(a, now)).map((meeting) => meeting.id)).toContain(outcome.meeting.id);
    }
    expect(await repo.userMeetings(amir.userId)).toEqual([]);
    expect((await repo.pendingCounts(asel.userId)).size).toBe(0);
  });
});

describe("встреча вдвоём в ленте календаря", () => {
  it("общая лента — со встречами вдвоём («Встреча вдвоём · имя»), лента одной группы — без них", async () => {
    const { pair } = await mods();
    const { NextRequest } = await import("next/server");
    const { GET } = await import("@/app/api/calendar/[token]/route");
    const { feedToken } = await import("@/lib/calendarFeed");
    const [amir, asel] = await friendsPair(8401, 8402, ["Амир", "Асель"]);
    const outcome = await pair.createPairMeeting(amir, asel.userId, input(soon().when, { goal: "" }));
    if (!("meeting" in outcome)) throw new Error(outcome.code);

    const feed = async (userId: number, query = "") => {
      const token = `${feedToken(userId)}.ics`;
      const response = await GET(new NextRequest(`https://qairu.example/api/calendar/${token}${query}`), {
        params: Promise.resolve({ token }),
      });
      return response.text();
    };
    const mine = await feed(amir.userId);
    expect(mine).toContain(`meeting-${outcome.meeting.id}`);
    expect(mine).toContain("Встреча вдвоём · Асель");
    expect(await feed(asel.userId)).toContain("Встреча вдвоём · Амир");
    expect(await feed(amir.userId, "?g=nosuchgroup")).not.toContain(`meeting-${outcome.meeting.id}`);
  });
});
