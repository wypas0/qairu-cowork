/**
 * Бот не верит данным, которые может подставить клиент: номеру чата в ссылке
 * `/start c<номер>`, номеру встречи в кнопке `card:ics:<номер>`, значениям в
 * кнопках `vote:` и `lang:` (ревью 16.11.2026, Р1, Р4, Р6).
 *
 * Свой файл и своя база: сценарии в tests/bot.test.ts зависят от порядка, и
 * лишний участник группы сломал бы им ростер.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { TgUpdate } from "@/bot/api";
import { startTestDb } from "./support/db";
import { installTelegramStub, type TelegramStub } from "./support/telegram";

const GROUP_ID = -1009876543210;
const AMIR = { id: 601, is_bot: false, first_name: "Амир", username: "amir6", language_code: "ru" };
const ASEL = { id: 602, is_bot: false, first_name: "Асель", username: "asel6", language_code: "ru" };
const BOLAT = { id: 603, is_bot: false, first_name: "Болат", username: "bolat6", language_code: "ru" };

type Person = typeof AMIR;
type Chat = { id: number; type: "private" | "supergroup"; title?: string };

const GROUP_CHAT: Chat = { id: GROUP_ID, type: "supergroup", title: "ИС-22" };
const privateOf = (person: Person): Chat => ({ id: person.id, type: "private" });

let stub: TelegramStub;
let updateId = 1;
let messageId = 1;
let handleUpdate: (update: TgUpdate) => Promise<void>;

function text(chat: Chat, from: Person, body: string): TgUpdate {
  return {
    update_id: updateId++,
    message: { message_id: messageId++, from, chat, date: Math.floor(Date.now() / 1000), text: body },
  } as TgUpdate;
}

function callback(chat: Chat, from: Person, data: string): TgUpdate {
  return {
    update_id: updateId++,
    callback_query: {
      id: `cb${updateId}`,
      from,
      data,
      message: { message_id: 900, chat, date: Math.floor(Date.now() / 1000) },
    },
  } as TgUpdate;
}

async function repo() {
  return import("@/db/repo");
}

/** Что бот ответил на голый /start этому человеку — эталон для отказов. */
async function plainStartReply(person: Person): Promise<Record<string, unknown>> {
  stub.reset();
  await handleUpdate(text(privateOf(person), person, "/start"));
  return stub.last("sendMessage")!.payload;
}

beforeAll(async () => {
  process.env.BOT_TOKEN = "123456:AAHtestTOKENtestTOKENtestTOKENtestTO";
  process.env.NEXT_PUBLIC_SITE_URL = "https://qairu.example";
  stub = installTelegramStub();
  await startTestDb();
  ({ handleUpdate } = await import("@/bot/router"));

  // Telegram-группа: подключил создатель чата.
  stub.memberStatus = "creator";
  await handleUpdate(text(GROUP_CHAT, AMIR, "/setup"));
});

beforeEach(() => {
  stub.reset();
  stub.memberStatus = "member";
  stub.memberIsMember = undefined;
  stub.memberError = null;
  stub.adminIds = [];
  stub.blockedIds = [];
});

describe("/start c<номер чата> (Р1)", () => {
  it("участник Telegram-чата вступает — Telegram подтвердил членство", async () => {
    stub.memberStatus = "member";
    await handleUpdate(text(privateOf(ASEL), ASEL, `/start c${GROUP_ID}`));

    expect(stub.last("getChatMember")?.payload).toEqual({ chat_id: GROUP_ID, user_id: ASEL.id });
    expect(stub.lastText()).toContain("Ты в группе");
    expect(await (await repo()).isMember(GROUP_ID, ASEL.id)).toBe(true);
  });

  it("ограниченный участник (restricted) вступает, только если он ещё в чате", async () => {
    const r = await repo();
    stub.memberStatus = "restricted";
    stub.memberIsMember = false;
    await handleUpdate(text(privateOf(BOLAT), BOLAT, `/start c${GROUP_ID}`));
    expect(await r.isMember(GROUP_ID, BOLAT.id)).toBe(false);

    stub.memberIsMember = true;
    await handleUpdate(text(privateOf(BOLAT), BOLAT, `/start c${GROUP_ID}`));
    expect(await r.isMember(GROUP_ID, BOLAT.id)).toBe(true);
    await r.removeMembership(GROUP_ID, BOLAT.id);
  });

  it.each(["left", "kicked"])("человек не из чата (%s) не вступает, ответ — как на обычный /start", async (status) => {
    const plain = await plainStartReply(BOLAT);

    stub.reset();
    stub.memberStatus = status;
    await handleUpdate(text(privateOf(BOLAT), BOLAT, `/start c${GROUP_ID}`));

    expect(stub.of("sendMessage")).toHaveLength(1);
    expect(stub.last("sendMessage")!.payload).toEqual(plain);
    expect(await (await repo()).isMember(GROUP_ID, BOLAT.id)).toBe(false);
  });

  it.each([
    ["бота нет в чате", { code: 403, description: "Forbidden: bot was kicked from the supergroup chat" }],
    ["Telegram не знает человека", { code: 400, description: "Bad Request: user not found" }],
    ["сеть недоступна", "network" as const],
  ])("%s — не вступает, ответ — как на обычный /start", async (_name, error) => {
    const plain = await plainStartReply(BOLAT);

    stub.reset();
    stub.memberError = error;
    await handleUpdate(text(privateOf(BOLAT), BOLAT, `/start c${GROUP_ID}`));

    expect(stub.last("sendMessage")!.payload).toEqual(plain);
    expect(await (await repo()).isMember(GROUP_ID, BOLAT.id)).toBe(false);
  });

  it("группа с сайта по номеру не вступает и Telegram не спрашивают; ответ — как на обычный /start", async () => {
    const r = await repo();
    const web = await r.createWebChat({ title: "С сайта" });
    const plain = await plainStartReply(BOLAT);

    stub.reset();
    stub.memberStatus = "creator";
    await handleUpdate(text(privateOf(BOLAT), BOLAT, `/start c${web.chatId}`));

    expect(stub.of("getChatMember")).toHaveLength(0);
    expect(stub.last("sendMessage")!.payload).toEqual(plain);
    expect(await r.isMember(web.chatId, BOLAT.id)).toBe(false);
  });

  it("несуществующий номер — тот же ответ, что и на обычный /start (так было и раньше)", async () => {
    const plain = await plainStartReply(BOLAT);
    stub.reset();
    await handleUpdate(text(privateOf(BOLAT), BOLAT, "/start c-1001111111111"));
    expect(stub.last("sendMessage")!.payload).toEqual(plain);
  });
});

describe("/start c<номер>_<подпись> — ссылка из кнопки бота (Р1)", () => {
  async function signed(chatId: number): Promise<string> {
    const { chatLinkParam } = await import("@/bot/site");
    return chatLinkParam(chatId);
  }

  it("кнопка «Заполнить расписание» в группе ведёт по подписанной ссылке", async () => {
    stub.memberStatus = "creator";
    await handleUpdate(text(GROUP_CHAT, AMIR, "/setup"));
    const markup = stub.last("sendMessage")!.payload.reply_markup as { inline_keyboard: { url?: string }[][] };
    expect(markup.inline_keyboard[0][0].url).toContain(`?start=${await signed(GROUP_ID)}`);
  });

  it.each([
    ["бот не админ и Telegram не ответил", { code: 400, description: "Bad Request: member list is inaccessible" }],
    ["сеть недоступна", "network" as const],
  ])("%s — по подписанной ссылке человек всё равно вступает", async (_name, error) => {
    const r = await repo();
    stub.memberError = error;
    await handleUpdate(text(privateOf(BOLAT), BOLAT, `/start ${await signed(GROUP_ID)}`));
    expect(stub.lastText()).toContain("Ты в группе");
    expect(await r.isMember(GROUP_ID, BOLAT.id)).toBe(true);
    await r.removeMembership(GROUP_ID, BOLAT.id);
  });

  it.each(["left", "kicked"])("Telegram прямо ответил «%s» — по подписанной ссылке не вступает", async (status) => {
    const plain = await plainStartReply(BOLAT);
    stub.reset();
    stub.memberStatus = status;
    await handleUpdate(text(privateOf(BOLAT), BOLAT, `/start ${await signed(GROUP_ID)}`));
    expect(stub.last("sendMessage")!.payload).toEqual(plain);
    expect(await (await repo()).isMember(GROUP_ID, BOLAT.id)).toBe(false);
  });

  it("подпись от другого чата или подделанная — ответ как на обычный /start", async () => {
    const plain = await plainStartReply(BOLAT);
    const other = (await signed(-1001111111111)).split("_")[1];
    for (const param of [`c${GROUP_ID}_${other}`, `c${GROUP_ID}_AAAAAAAAAAAAAAAA`]) {
      stub.reset();
      stub.memberError = { code: 400, description: "Bad Request: member list is inaccessible" };
      await handleUpdate(text(privateOf(BOLAT), BOLAT, `/start ${param}`));
      expect(stub.last("sendMessage")!.payload).toEqual(plain);
    }
    expect(await (await repo()).isMember(GROUP_ID, BOLAT.id)).toBe(false);
  });

  it("группа с сайта по подписанной ссылке не вступает", async () => {
    const r = await repo();
    const web = await r.createWebChat({ title: "С сайта 2" });
    await handleUpdate(text(privateOf(BOLAT), BOLAT, `/start ${await signed(web.chatId)}`));
    expect(stub.of("getChatMember")).toHaveLength(0);
    expect(await r.isMember(web.chatId, BOLAT.id)).toBe(false);
  });
});

const STRANGER = { id: 699, is_bot: false, first_name: "Чужак", username: "stranger6", language_code: "ru" };

/** Встреча группы: приглашены Амир и Асель; Болат вступил позже и не приглашён. */
async function groupMeeting(goal: string) {
  const r = await repo();
  await r.addMembership(GROUP_ID, AMIR.id);
  await r.addMembership(GROUP_ID, ASEL.id);
  const meeting = await r.createMeeting({
    chatId: GROUP_ID,
    initiatorId: AMIR.id,
    place: "Библиотека",
    whenText: "пятница, 15:00",
    goal,
    invitees: [AMIR.id, ASEL.id],
    whenStart: new Date("2026-12-04T10:00:00.000Z"),
    durationMin: 90,
  });
  await r.addMembership(GROUP_ID, BOLAT.id);
  return meeting;
}

/** Нажатие закрыто молча: ни текста, ни окна — как у несуществующей встречи. */
function expectSilentAnswer(): void {
  const answers = stub.of("answerCallbackQuery");
  expect(answers).toHaveLength(1);
  expect(Object.keys(answers[0].payload)).toEqual(["callback_query_id"]);
}

describe("кнопка .ics в карточке встречи (Р4)", () => {
  it("приглашённый получает файл встречи", async () => {
    const meeting = await groupMeeting("Секретный проект");
    await handleUpdate(callback(GROUP_CHAT, ASEL, `card:ics:${meeting.id}`));
    expect(stub.of("sendDocument")).toHaveLength(1);
  });

  it("участник группы, которого не звали, тоже получает — встреча его группы", async () => {
    const meeting = await groupMeeting("Секретный проект");
    await handleUpdate(callback(privateOf(BOLAT), BOLAT, `card:ics:${meeting.id}`));
    expect(stub.of("sendDocument")).toHaveLength(1);
  });

  it("чужой не получает файл; ответ — как на несуществующую встречу", async () => {
    const meeting = await groupMeeting("Секретный проект");

    await handleUpdate(callback(privateOf(STRANGER), STRANGER, "card:ics:987654321"));
    expectSilentAnswer();

    stub.reset();
    await handleUpdate(callback(privateOf(STRANGER), STRANGER, `card:ics:${meeting.id}`));
    expect(stub.of("sendDocument")).toHaveLength(0);
    expectSilentAnswer();
  });

  it("встреча вдвоём — файл только двоим", async () => {
    const r = await repo();
    const pair = await r.createPairMeeting({
      initiatorId: AMIR.id,
      withUser: BOLAT.id,
      place: "Кофейня",
      whenText: "суббота, 12:00",
      goal: "Вдвоём",
      whenStart: new Date("2026-12-05T07:00:00.000Z"),
      durationMin: 60,
    });

    await handleUpdate(callback(privateOf(BOLAT), BOLAT, `card:ics:${pair.id}`));
    expect(stub.of("sendDocument")).toHaveLength(1);

    stub.reset();
    // Асель в одной группе с обоими, но встреча не её.
    await handleUpdate(callback(privateOf(ASEL), ASEL, `card:ics:${pair.id}`));
    expect(stub.of("sendDocument")).toHaveLength(0);
    expectSilentAnswer();
  });
});

describe("значения в кнопках vote: и lang: (Р6)", () => {
  it.each(["lol", "", "YES"])("ответ «%s» не сохраняется, нажатие закрывается молча", async (answer) => {
    const r = await repo();
    const meeting = await groupMeeting("Проверка ответов");
    await handleUpdate(callback(GROUP_CHAT, ASEL, `vote:${meeting.id}:${answer}`));

    expect(await r.meetingResponsesFor(meeting.id)).toEqual([]);
    expectSilentAnswer();
    expect(stub.of("editMessageText")).toHaveLength(0);
    expect(stub.of("sendMessage")).toHaveLength(0);
  });

  it("настоящий ответ по-прежнему записывается", async () => {
    const r = await repo();
    const meeting = await groupMeeting("Проверка ответов");
    await handleUpdate(callback(GROUP_CHAT, ASEL, `vote:${meeting.id}:maybe`));
    expect((await r.meetingResponsesFor(meeting.id)).map((row) => row.answer)).toEqual(["maybe"]);
  });

  it.each(["xx", "", "RU"])("язык «%s» в личке не ставится, нажатие закрывается молча", async (code) => {
    const r = await repo();
    await handleUpdate(text(privateOf(ASEL), ASEL, "/start"));
    stub.reset();

    await handleUpdate(callback(privateOf(ASEL), ASEL, `lang:${code}`));
    expect((await r.getUser(ASEL.id))?.lang).toBe("ru");
    expectSilentAnswer();
    expect(stub.of("editMessageText")).toHaveLength(0);
  });

  it("язык «xx» в группе от админа не ставится ни чату, ни человеку", async () => {
    const r = await repo();
    stub.memberStatus = "creator";
    await handleUpdate(callback(GROUP_CHAT, AMIR, "lang:xx"));
    expect((await r.getChat(GROUP_ID))?.lang).toBe("ru");
    expect((await r.getUser(AMIR.id))?.lang).toBe("ru");
    expectSilentAnswer();
  });

  it("настоящий язык по-прежнему переключается", async () => {
    const r = await repo();
    await handleUpdate(callback(privateOf(ASEL), ASEL, "lang:en"));
    expect((await r.getUser(ASEL.id))?.lang).toBe("en");
    await r.setUserLang(ASEL.id, "ru");
  });
});
