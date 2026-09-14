/**
 * Вход и регистрация на сайте через Telegram-бота.
 *
 * Сайт создаёт запрос, бот (настоящий маршрутизатор поверх заглушки Bot API)
 * подтверждает его, страница забирает сессию. Отдельно — перенос аккаунта,
 * заведённого на сайте без Telegram.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { TgUpdate } from "@/bot/api";
import { startTestDb } from "./support/db";
import { installTelegramStub, type TelegramStub } from "./support/telegram";

let stub: TelegramStub;
let handleUpdate: (update: TgUpdate) => Promise<void>;
let updateId = 5000;
let tgId = 880000;

beforeAll(async () => {
  process.env.BOT_TOKEN = "123456:AAHtestTOKENtestTOKENtestTOKENtestTO";
  process.env.NEXT_PUBLIC_SITE_URL = "https://qairu.example";
  stub = installTelegramStub();
  await startTestDb();
  ({ handleUpdate } = await import("@/bot/router"));
});

beforeEach(() => {
  stub.reset();
});

async function mods() {
  return {
    repo: await import("@/db/repo"),
    login: await import("@/lib/tglogin"),
  };
}

function tgUser(first = "Амир", username = "amir_tg") {
  tgId += 1;
  return { id: tgId, is_bot: false, first_name: first, last_name: "Тест", username, language_code: "ru" };
}

async function start(from: ReturnType<typeof tgUser>, code: string) {
  await handleUpdate({
    update_id: updateId++,
    message: {
      message_id: updateId,
      from,
      chat: { id: from.id, type: "private" },
      date: Math.floor(Date.now() / 1000),
      text: `/start login_${code}`,
    },
  });
}

async function press(from: ReturnType<typeof tgUser>, data: string) {
  await handleUpdate({
    update_id: updateId++,
    callback_query: {
      id: `cb${updateId}`,
      from,
      data,
      message: { message_id: 321, chat: { id: from.id, type: "private" }, date: 0 },
    },
  });
}

/** Создать запрос так, как это делает кнопка на /login. */
async function newRequest(options: { mergeFrom?: import("@/db/schema").User | null; next?: string } = {}) {
  const { login } = await mods();
  const created = await login.createLoginRequest({
    next: options.next ?? "/",
    mergeFrom: options.mergeFrom ?? null,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36",
  });
  return { ...created, cookie: `${created.code}.${created.secret}` };
}

describe("вход через бота", () => {
  it("полный путь: ссылка → «Подтвердить» → сайт получает вход, запрос одноразовый", async () => {
    const { login, repo } = await mods();
    const person = tgUser();
    const request = await newRequest({ next: "/g/abc" });
    expect(request.code).toMatch(login.LOGIN_CODE_RE);

    expect(await login.completeLoginRequest(request.cookie, null)).toEqual({ status: "pending" });

    await start(person, request.code);
    const prompt = stub.last("sendMessage");
    expect(prompt?.payload.chat_id).toBe(person.id);
    expect(String(prompt?.payload.text)).toContain("Амир Тест");
    expect(String(prompt?.payload.text)).toContain("@amir_tg");
    expect(String(prompt?.payload.text)).toContain("Chrome · Windows");
    expect(JSON.stringify(prompt?.payload.reply_markup)).toContain(`tgl:ok:${request.code}`);

    // Открыл, но ещё не подтвердил — сайт ждёт.
    expect(await login.completeLoginRequest(request.cookie, null)).toEqual({ status: "pending" });

    await press(person, `tgl:ok:${request.code}`);
    expect(stub.lastText("editMessageText")).toContain("Готово");

    // Код без секрета из куки ничего не даёт.
    expect(await login.completeLoginRequest(`${request.code}.wrongsecret`, null)).toEqual({ status: "invalid" });

    const done = await login.completeLoginRequest(request.cookie, null);
    expect(done).toEqual({ status: "ok", userId: person.id, next: "/g/abc", merged: false });
    // Второй раз тем же запросом войти нельзя.
    expect(await login.completeLoginRequest(request.cookie, null)).toEqual({ status: "invalid" });

    // Регистрация: аккаунт создан из данных Telegram.
    const user = await repo.getUser(person.id);
    expect(user).toMatchObject({ fullName: "Амир Тест", username: "amir_tg", isWeb: false });
  });

  it("параллельные опросы после подтверждения выдают вход ровно один раз", async () => {
    const { login } = await mods();
    const person = tgUser("Параллель", "par_tg");
    const request = await newRequest();
    await start(person, request.code);
    await press(person, `tgl:ok:${request.code}`);

    const results = await Promise.all(
      Array.from({ length: 6 }, () => login.completeLoginRequest(request.cookie, null)),
    );
    expect(results.filter((result) => result.status === "ok")).toHaveLength(1);
  });

  it("«Это не я» отклоняет вход", async () => {
    const { login } = await mods();
    const person = tgUser("Отказ", "no_tg");
    const request = await newRequest();
    await start(person, request.code);
    await press(person, `tgl:no:${request.code}`);

    expect(stub.lastText("editMessageText")).toContain("отклонён");
    expect(await login.completeLoginRequest(request.cookie, null)).toEqual({ status: "rejected" });
  });

  it("подтвердить может только тот, кто открыл ссылку", async () => {
    const { login } = await mods();
    const owner = tgUser("Владелец", "owner_tg");
    const stranger = tgUser("Чужой", "stranger_tg");
    const request = await newRequest();
    await start(owner, request.code);

    await press(stranger, `tgl:ok:${request.code}`);
    expect(stub.last("answerCallbackQuery")?.payload.show_alert).toBe(true);
    expect(await login.completeLoginRequest(request.cookie, null)).toEqual({ status: "pending" });

    // И открыть уже закреплённую ссылку чужой тоже не может.
    await start(stranger, request.code);
    expect(stub.lastText()).toContain("открыл ссылку");
  });

  it("устаревшая и выдуманная ссылки не работают", async () => {
    const { login, repo } = await mods();
    const person = tgUser("Поздно", "late_tg");
    const request = await newRequest();
    const key = `tglogin:${request.code}`;
    const stored = await repo.getBotState<import("@/lib/tglogin").LoginRequest>(key);
    await repo.setBotState(key, { ...stored!, createdAt: Date.now() - login.LOGIN_REQUEST_TTL_MS - 1000 });

    await start(person, request.code);
    expect(stub.lastText()).toContain("устарела");
    expect(await login.completeLoginRequest(request.cookie, null)).toEqual({ status: "expired" });

    await start(person, "NoSuchCodeNoSuchCode");
    expect(stub.lastText()).toContain("не найдена");
  });

  it("определение устройства по User-Agent", async () => {
    const { login } = await mods();
    expect(login.describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1")).toBe("Safari · iOS");
    expect(login.describeDevice("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36")).toBe("Chrome · Android");
    expect(login.describeDevice("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/129.0 Safari/537.36 Edg/129.0")).toBe("Edge · Windows");
    expect(login.describeDevice("")).toBe("неизвестное устройство");
  });
});

describe("перенос аккаунта с сайта в Telegram", () => {
  async function webAccountWithEverything() {
    const { repo } = await mods();
    const web = await repo.createWebUser({ fullName: "Амир с сайта", lang: "ru" });
    const chat = await repo.createWebChat({ title: "Перенос", tz: "Asia/Almaty", lang: "ru" });
    await repo.updateChat(chat.chatId, { createdBy: web.userId });
    await repo.addMembership(chat.chatId, web.userId, undefined, "admin");
    const friend = await repo.createWebUser({ fullName: "Асель", lang: "ru" });
    await repo.addMembership(chat.chatId, friend.userId);
    await repo.replaceWeeklySlots(web.userId, [0], [{ weekday: 0, start: 540, end: 630 }], "web");
    const meeting = await repo.createMeeting({
      chatId: chat.chatId,
      initiatorId: web.userId,
      place: "",
      whenText: "",
      goal: "Встреча",
      invitees: [web.userId, friend.userId],
    });
    await repo.setResponse({ meetingId: meeting.id, userId: web.userId, answer: "yes" });
    await repo.addNotices([{ chatId: chat.chatId, userId: web.userId, kind: "fill_schedule", fromUserId: friend.userId }]);
    const otherDevice = await repo.issueWebSession(web.userId);
    return { web, chat, friend, meeting, otherDevice };
  }

  it("группы, роль, расписание, встречи, уведомления и сессии переходят к Telegram-аккаунту", async () => {
    const { login, repo } = await mods();
    const { web, chat, meeting, otherDevice } = await webAccountWithEverything();
    const person = tgUser("Амир", "merge_tg");

    const request = await newRequest({ mergeFrom: web });
    await start(person, request.code);
    await press(person, `tgl:ok:${request.code}`);
    const done = await login.completeLoginRequest(request.cookie, web);
    expect(done).toMatchObject({ status: "ok", userId: person.id, merged: true });

    expect(await repo.getUser(web.userId)).toBeNull();
    expect(await repo.memberRole(chat.chatId, person.id)).toBe("admin");
    expect((await repo.getChat(chat.chatId))?.createdBy).toBe(person.id);
    expect(await repo.getSlots(person.id)).toHaveLength(1);
    expect(await repo.isFilled(person.id)).toBe(true);

    const moved = (await repo.getMeeting(meeting.id))!;
    expect(moved.initiatorId).toBe(person.id);
    expect(repo.inviteeIds(moved)).toContain(person.id);
    expect(repo.inviteeIds(moved)).not.toContain(web.userId);
    expect((await repo.meetingResponsesFor(meeting.id)).map((row) => row.userId)).toEqual([person.id]);
    // Уведомление «заполни расписание» уже выполнено — расписание перенесено вместе с ним.
    expect((await repo.userByWebToken(otherDevice))?.userId).toBe(person.id);
  });

  it("при конфликте остаются данные Telegram-аккаунта", async () => {
    const { login, repo } = await mods();
    const { web, meeting } = await webAccountWithEverything();
    const person = tgUser("Уже был", "had_tg");
    await repo.upsertUser({ userId: person.id, fullName: "Уже был", username: "had_tg" });
    await repo.replaceWeeklySlots(person.id, [2], [{ weekday: 2, start: 600, end: 700 }], "wizard");
    await repo.setResponse({ meetingId: meeting.id, userId: person.id, answer: "no" });

    const request = await newRequest({ mergeFrom: web });
    await start(person, request.code);
    await press(person, `tgl:ok:${request.code}`);
    await login.completeLoginRequest(request.cookie, web);

    const slots = await repo.getSlots(person.id);
    expect(slots.map((slot) => slot.weekday)).toEqual([2]);
    const answers = await repo.meetingResponsesFor(meeting.id);
    expect(answers.filter((row) => row.userId === person.id).map((row) => row.answer)).toEqual(["no"]);
  });

  it("переносится только тот сайтовый аккаунт, что был в браузере при старте и остался в нём", async () => {
    const { login, repo } = await mods();
    const { web } = await webAccountWithEverything();
    const person = tgUser("Без переноса", "nomerge_tg");

    const request = await newRequest({ mergeFrom: web });
    await start(person, request.code);
    await press(person, `tgl:ok:${request.code}`);
    // К моменту опроса в браузере уже никого нет (вышел) — переносить нечего.
    const done = await login.completeLoginRequest(request.cookie, null);
    expect(done).toMatchObject({ status: "ok", merged: false });
    expect(await repo.getUser(web.userId)).not.toBeNull();
  });

  it("Telegram-аккаунт не «переносится» в другой Telegram-аккаунт", async () => {
    const { repo } = await mods();
    const a = tgUser("А", "a_tg");
    const b = tgUser("Б", "b_tg");
    await repo.upsertUser({ userId: a.id, fullName: "А" });
    await repo.upsertUser({ userId: b.id, fullName: "Б" });
    expect(await repo.mergeWebUserIntoTelegram(a.id, b.id)).toBe(false);
    expect(await repo.getUser(a.id)).not.toBeNull();
  });
});
