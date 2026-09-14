/**
 * Администраторы, уведомления, вход по паролю и разовая занятость с сайта.
 *
 * Логика проверяется на слое repo/lib поверх настоящего Postgres; наружу вместо
 * Bot API стоит заглушка, которая записывает вызовы и умеет отвечать 403.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { startTestDb } from "./support/db";
import { installTelegramStub, type TelegramStub } from "./support/telegram";

let stub: TelegramStub;

beforeAll(async () => {
  process.env.BOT_TOKEN = "123456:AAHtestTOKENtestTOKENtestTOKENtestTO";
  process.env.NEXT_PUBLIC_SITE_URL = "https://qairu.example";
  stub = installTelegramStub();
  await startTestDb();
});

beforeEach(() => {
  stub.reset();
  stub.adminIds = [];
  stub.blockedIds = [];
});

async function mods() {
  return {
    repo: await import("@/db/repo"),
    admin: await import("@/lib/admin"),
    notify: await import("@/lib/notify"),
    schema: await import("@/db/schema"),
  };
}

let tgId = 7000;

/** Группа с сайта: создатель — админ, как делает форма на лендинге. */
async function webGroup(title: string) {
  const { repo, schema } = await mods();
  return repo.transaction(async (tx) => {
    const chat = await repo.createWebChat({ title, tz: "Asia/Almaty", lang: "ru" }, tx);
    const owner = await repo.createWebUser({ fullName: "Создатель", lang: "ru" }, tx);
    await repo.updateChat(chat.chatId, { createdBy: owner.userId }, tx);
    await repo.addMembership(chat.chatId, owner.userId, tx, schema.ROLE_ADMIN);
    return { chat: (await repo.getChat(chat.chatId, tx))!, owner };
  });
}

async function webMember(chatId: number, name: string) {
  const { repo } = await mods();
  const user = await repo.createWebUser({ fullName: name, lang: "ru" });
  await repo.addMembership(chatId, user.userId);
  return user;
}

async function telegramMember(chatId: number, name: string, username?: string) {
  const { repo } = await mods();
  const user = await repo.upsertUser({ userId: ++tgId, fullName: name, username: username ?? null });
  await repo.addMembership(chatId, user.userId);
  return user;
}

describe("администраторы", () => {
  it("создатель группы — администратор, обычный участник — нет", async () => {
    const { admin } = await mods();
    const { chat, owner } = await webGroup("Роли");
    const member = await webMember(chat.chatId, "Асель");

    expect(await admin.adminSource(chat, owner.userId)).toBe("creator");
    expect(await admin.isGroupAdmin(chat, member.userId)).toBe(false);
  });

  it("назначенный на сайте админ получает права и теряет их при снятии", async () => {
    const { admin, repo } = await mods();
    const { chat } = await webGroup("Назначение");
    const member = await webMember(chat.chatId, "Асель");

    await repo.setMemberRole(chat.chatId, member.userId, "admin");
    expect(await admin.adminSource(chat, member.userId)).toBe("site");

    await repo.setMemberRole(chat.chatId, member.userId, "member");
    expect(await admin.isGroupAdmin(chat, member.userId)).toBe(false);
  });

  it("сменить роль можно только участнику группы", async () => {
    const { repo } = await mods();
    const { chat } = await webGroup("Чужой");
    const outsider = await repo.createWebUser({ fullName: "Посторонний", lang: "ru" });
    expect(await repo.setMemberRole(chat.chatId, outsider.userId, "admin")).toBe(false);
  });

  it("в Telegram-группе админы чата — админы и на сайте, с кэшем", async () => {
    const { admin, repo } = await mods();
    const chat = await repo.upsertChat(-100777000111, "ТГ-группа");
    const amir = await telegramMember(chat.chatId, "Амир");
    const asel = await telegramMember(chat.chatId, "Асель");

    stub.adminIds = [amir.userId];
    expect(await admin.adminSource(chat, amir.userId)).toBe("telegram");
    expect(await admin.isGroupAdmin(chat, asel.userId)).toBe(false);
    expect(stub.of("getChatAdministrators")).toHaveLength(1);

    // Повторная проверка в течение 10 минут не ходит в Telegram.
    await admin.isGroupAdmin(chat, amir.userId);
    expect(stub.of("getChatAdministrators")).toHaveLength(1);
  });

  it("в группе с сайта Telegram не спрашивают вовсе", async () => {
    const { admin } = await mods();
    const { chat } = await webGroup("Без Telegram");
    expect(await admin.telegramAdminIds(chat)).toEqual([]);
    expect(stub.of("getChatAdministrators")).toHaveLength(0);
  });

  it("список участников: админы первыми", async () => {
    const { repo } = await mods();
    const { chat, owner } = await webGroup("Порядок");
    await webMember(chat.chatId, "Аа первый по алфавиту");
    const roster = await repo.chatRoster(chat.chatId);
    expect(roster[0].user.userId).toBe(owner.userId);
    expect(roster[0].role).toBe("admin");
  });

  it("миграция делает первого участника старой группы с сайта её создателем", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const client = new PGlite();
    const run = async (file: string) => {
      const sql = await readFile(fileURLToPath(new URL(`../drizzle/${file}`, import.meta.url)), "utf8");
      for (const part of sql.split("--> statement-breakpoint")) if (part.trim()) await client.exec(part);
    };
    await run("0000_init.sql");
    await client.exec(`
      INSERT INTO users (user_id, full_name, is_web) VALUES (-1000000000000001, 'Первый', true), (-1000000000000002, 'Второй', true);
      INSERT INTO chats (chat_id, slug, origin, title) VALUES (-1000000000000010, 'oldgroup', 'web', 'Старая');
      INSERT INTO memberships (chat_id, user_id, joined_at) VALUES
        (-1000000000000010, -1000000000000001, '2026-01-01T10:00:00Z'),
        (-1000000000000010, -1000000000000002, '2026-01-02T10:00:00Z');
    `);
    await run("0001_admin_login.sql");

    const chat = await client.query<{ created_by: string }>("SELECT created_by FROM chats");
    expect(Number(chat.rows[0].created_by)).toBe(-1000000000000001);
    const roles = await client.query<{ user_id: string; role: string }>(
      "SELECT user_id, role FROM memberships ORDER BY joined_at",
    );
    expect(roles.rows.map((row) => row.role)).toEqual(["admin", "member"]);
  });
});

describe("уведомления", () => {
  it("новая встреча: Telegram-участнику — в личку, веб-участнику и заблокировавшему — баннер", async () => {
    const { repo, notify } = await mods();
    const { chat, owner } = await webGroup("Встреча");
    const web = await webMember(chat.chatId, "Без Telegram");
    const tg = await telegramMember(chat.chatId, "С Telegram");
    const blocked = await telegramMember(chat.chatId, "Не нажал /start");
    stub.blockedIds = [blocked.userId];

    const meeting = await repo.createMeeting({
      chatId: chat.chatId,
      initiatorId: owner.userId,
      place: "Библиотека",
      whenText: "пн · 10:00–11:00",
      goal: "Разбор задач",
      invitees: [owner.userId, web.userId, tg.userId, blocked.userId],
    });
    const delivery = await notify.notifyMeetingCreated(chat, meeting);

    expect(delivery).toEqual({ telegram: 1, site: 2 });
    const dm = stub.of("sendMessage").find((call) => call.payload.chat_id === tg.userId);
    expect(String(dm?.payload.text)).toContain("Разбор задач");
    expect(JSON.stringify(dm?.payload.reply_markup)).toContain(`vote:${meeting.id}:yes`);

    expect((await repo.unreadNotices(chat.chatId, web.userId)).map((n) => n.kind)).toEqual(["meeting"]);
    expect(await repo.unreadNotices(chat.chatId, blocked.userId)).toHaveLength(1);
    expect(await repo.unreadNotices(chat.chatId, tg.userId)).toHaveLength(0);
    expect(await repo.unreadNotices(chat.chatId, owner.userId)).toHaveLength(0);
  });

  it("в Telegram-группе карточка встречи публикуется в самом чате", async () => {
    const { repo, notify } = await mods();
    const chat = await repo.upsertChat(-100777000222, "ТГ встречи");
    await repo.updateChat(chat.chatId, { slug: "tgmeet01" });
    const fresh = (await repo.getChat(chat.chatId))!;
    const amir = await telegramMember(chat.chatId, "Амир");
    const asel = await telegramMember(chat.chatId, "Асель");

    const meeting = await repo.createMeeting({
      chatId: chat.chatId,
      initiatorId: amir.userId,
      place: "Кафе",
      whenText: "вт",
      goal: "Проект",
      invitees: [amir.userId, asel.userId],
    });
    const delivery = await notify.notifyMeetingCreated(fresh, meeting);

    expect(delivery.telegram).toBe(1);
    expect(stub.of("sendMessage").map((call) => call.payload.chat_id)).toEqual([chat.chatId]);
    expect((await repo.getMeeting(meeting.id))?.chatMessageId).toBeTruthy();
  });

  it("ответ убирает баннер, «предложить изменения» уведомляет организатора", async () => {
    const { repo, notify } = await mods();
    const { chat, owner } = await webGroup("Ответы");
    const web = await webMember(chat.chatId, "Асель");
    const meeting = await repo.createMeeting({
      chatId: chat.chatId,
      initiatorId: owner.userId,
      place: "X",
      whenText: "ср",
      goal: "Обсудить",
      invitees: [owner.userId, web.userId],
    });
    await notify.notifyMeetingCreated(chat, meeting);
    expect(await repo.unreadNotices(chat.chatId, web.userId)).toHaveLength(1);

    await repo.setResponse({ meetingId: meeting.id, userId: web.userId, answer: "change", comment: "лучше в 16:00" });
    await notify.notifyVote(chat, meeting, web, "change", "лучше в 16:00");

    expect(await repo.unreadNotices(chat.chatId, web.userId)).toHaveLength(0);
    const ownerNotices = await repo.unreadNotices(chat.chatId, owner.userId);
    expect(ownerNotices.map((n) => [n.kind, n.text])).toEqual([["meeting_change", "лучше в 16:00"]]);
  });

  it("напоминание неответившим не трогает тех, кто уже ответил", async () => {
    const { repo, notify } = await mods();
    const { chat, owner } = await webGroup("Пинг");
    const answered = await webMember(chat.chatId, "Ответил");
    const silent = await webMember(chat.chatId, "Молчит");
    const meeting = await repo.createMeeting({
      chatId: chat.chatId,
      initiatorId: owner.userId,
      place: "Y",
      whenText: "чт",
      goal: "Z",
      invitees: [owner.userId, answered.userId, silent.userId],
    });
    await repo.setResponse({ meetingId: meeting.id, userId: answered.userId, answer: "yes" });

    const delivery = await notify.notifyNonResponders(chat, meeting, owner);
    expect(delivery).toEqual({ telegram: 0, site: 1 });
    expect(await repo.unreadNotices(chat.chatId, answered.userId)).toHaveLength(0);
    expect(await repo.unreadNotices(chat.chatId, silent.userId)).toHaveLength(1);
  });

  it("просьба заполнить расписание: личка в Telegram, баннер на сайте, гаснет после сохранения", async () => {
    const { repo, notify } = await mods();
    const { chat, owner } = await webGroup("Заполните");
    const web = await webMember(chat.chatId, "Веб");
    const tg = await telegramMember(chat.chatId, "Телеграм");

    const delivery = await notify.notifyFillSchedule(chat, owner, [web, tg]);
    expect(delivery).toEqual({ telegram: 1, site: 1 });
    const dm = stub.of("sendMessage").find((call) => call.payload.chat_id === tg.userId);
    expect(JSON.stringify(dm?.payload.reply_markup)).toContain(`/g/${chat.slug}/me`);

    expect(await repo.unreadNotices(chat.chatId, web.userId)).toHaveLength(1);
    await repo.replaceWeeklySlots(web.userId, [0, 1, 2, 3, 4, 5, 6], [], "web");
    expect(await repo.unreadNotices(chat.chatId, web.userId)).toHaveLength(0);
  });

  it("в Telegram-группе просьба заполнить — одно общее сообщение, а не рассылка", async () => {
    const { repo, notify } = await mods();
    const chat = await repo.upsertChat(-100777000333, "ТГ напоминание");
    const amir = await telegramMember(chat.chatId, "Амир");
    const asel = await telegramMember(chat.chatId, "Асель");
    const bolat = await telegramMember(chat.chatId, "Болат");

    await notify.notifyFillSchedule(chat, amir, [asel, bolat]);
    const sent = stub.of("sendMessage");
    expect(sent).toHaveLength(1);
    expect(sent[0].payload.chat_id).toBe(chat.chatId);
    expect(String(sent[0].payload.text)).toContain(`tg://user?id=${asel.userId}`);
  });

  it("отмена встречи закрывает её баннеры у всех", async () => {
    const { repo, notify } = await mods();
    const { chat, owner } = await webGroup("Отмена");
    const web = await webMember(chat.chatId, "Асель");
    const meeting = await repo.createMeeting({
      chatId: chat.chatId,
      initiatorId: owner.userId,
      place: "",
      whenText: "",
      goal: "Отменяемая",
      invitees: [owner.userId, web.userId],
    });
    await notify.notifyMeetingCreated(chat, meeting);
    await repo.closeMeetingNotices(meeting.id);
    expect(await repo.unreadNotices(chat.chatId, web.userId)).toHaveLength(0);
  });
});

describe("вход по логину и паролю", () => {
  it("хэш scrypt проверяется, чужой пароль и битый хэш — нет", async () => {
    const { hashPassword, verifyPassword } = await import("@/lib/password");
    const hash = await hashPassword("correct horse");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(hash).not.toContain("correct horse");
    expect(await verifyPassword("correct horse", hash)).toBe(true);
    expect(await verifyPassword("wrong horse", hash)).toBe(false);
    expect(await verifyPassword("correct horse", "garbage")).toBe(false);
    // Одинаковые пароли дают разные хэши — соль случайная.
    expect(await hashPassword("correct horse")).not.toBe(hash);
  });

  it("проверка формы: формат логина, длина и совпадение паролей", async () => {
    const { validateCredentials, normalizeLogin } = await import("@/lib/password");
    const ok = { login: "Amir_01", password: "12345678", confirm: "12345678" };
    expect(validateCredentials(ok)).toBeNull();
    expect(normalizeLogin("  @Amir_01 ")).toBe("amir_01");
    expect(validateCredentials({ ...ok, login: "ab" })).toBe("login_format");
    expect(validateCredentials({ ...ok, login: "амир" })).toBe("login_format");
    expect(validateCredentials({ ...ok, password: "1234567", confirm: "1234567" })).toBe("password_short");
    expect(validateCredentials({ ...ok, confirm: "87654321" })).toBe("password_mismatch");
  });

  it("находит по логину сайта и по @username подтверждённого Telegram-аккаунта", async () => {
    const { repo } = await mods();
    const { hashPassword } = await import("@/lib/password");
    const web = await repo.createWebUser({ fullName: "Веб", lang: "ru" });
    await repo.setCredentials({ userId: web.userId, login: "webuser", passwordHash: await hashPassword("password1") });
    const tg = await repo.upsertUser({ userId: ++tgId, fullName: "ТГ", username: "TgPerson" });
    await repo.setCredentials({ userId: tg.userId, login: "tglogin", passwordHash: await hashPassword("password2") });

    expect((await repo.credentialsForLogin("WebUser"))?.user.userId).toBe(web.userId);
    expect((await repo.credentialsForLogin("@tgperson"))?.user.userId).toBe(tg.userId);
    expect((await repo.credentialsForLogin("tgperson"))?.user.userId).toBe(tg.userId);
    // С @ ищется только Telegram-ник, логин сайта так не подойдёт.
    expect(await repo.credentialsForLogin("@webuser")).toBeNull();
    expect(await repo.credentialsForLogin("nobody")).toBeNull();
  });

  it("ник веб-пользователя без Telegram для входа не годится", async () => {
    const { repo } = await mods();
    const { hashPassword } = await import("@/lib/password");
    const web = await repo.createWebUser({ fullName: "Самозванец", lang: "ru" });
    // Даже если в users.username каким-то образом записан чужой ник.
    const db = (globalThis as unknown as { __qairuDb: import("drizzle-orm/pglite").PgliteDatabase }).__qairuDb;
    const { users } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    await db.update(users).set({ username: "durov" }).where(eq(users.userId, web.userId));
    await repo.setCredentials({ userId: web.userId, login: "impostor", passwordHash: await hashPassword("password3") });

    expect(await repo.credentialsForLogin("@durov")).toBeNull();
  });

  it("логин не может совпасть с чужим логином или чужим Telegram-ником", async () => {
    const { repo } = await mods();
    const { hashPassword } = await import("@/lib/password");
    const a = await repo.createWebUser({ fullName: "А", lang: "ru" });
    const b = await repo.createWebUser({ fullName: "Б", lang: "ru" });
    await repo.setCredentials({ userId: a.userId, login: "takenlogin", passwordHash: await hashPassword("password4") });
    await repo.upsertUser({ userId: ++tgId, fullName: "Ник", username: "famousnick" });

    expect(await repo.loginTaken("takenlogin", b.userId)).toBe(true);
    expect(await repo.loginTaken("takenlogin", a.userId)).toBe(false);
    expect(await repo.loginTaken("famousnick", b.userId)).toBe(true);
    expect(await repo.loginTaken("freelogin", b.userId)).toBe(false);
  });

  it("смена пароля обрывает остальные сессии, выход удаляет сессию", async () => {
    const { repo } = await mods();
    const user = await repo.createWebUser({ fullName: "Сессии", lang: "ru" });
    const keep = await repo.issueWebSession(user.userId);
    const other = await repo.issueWebSession(user.userId);

    await repo.deleteOtherWebSessions(user.userId, keep);
    expect(await repo.userByWebToken(keep)).not.toBeNull();
    expect(await repo.userByWebToken(other)).toBeNull();

    await repo.deleteWebSession(keep);
    expect(await repo.userByWebToken(keep)).toBeNull();
  });

  it("счётчик попыток считает в окне и сбрасывается по времени", async () => {
    const { repo } = await mods();
    expect(await repo.bumpCounter("login:counter-test", 60_000)).toBe(1);
    expect(await repo.bumpCounter("login:counter-test", 60_000)).toBe(2);
    expect(await repo.peekCounter("login:counter-test", 60_000)).toBe(2);
    expect(await repo.peekCounter("login:counter-test", -1)).toBe(0);
  });

  it("адрес возврата после входа — только путь внутри сайта", async () => {
    const { safeNext } = await import("@/lib/auth");
    expect(safeNext("/g/abc/me")).toBe("/g/abc/me");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("/\\evil.example")).toBe("/");
    expect(safeNext("")).toBe("/");
  });
});

describe("разовая занятость с сайта", () => {
  const TODAY = "2026-09-14";
  const base = { dateFrom: "2026-09-20", dateTo: "", allDay: true, start: "", end: "", label: " Экзамен " };

  it("одна дата на весь день", async () => {
    const { parseDatedBusy } = await import("@/core/dated");
    expect(parseDatedBusy(base, TODAY)).toEqual({
      ok: true,
      value: { dateFrom: "2026-09-20", dateTo: null, start: 0, end: 1440, label: "Экзамен" },
    });
  });

  it("период с часами", async () => {
    const { parseDatedBusy } = await import("@/core/dated");
    const parsed = parseDatedBusy(
      { ...base, dateTo: "2026-09-25", allDay: false, start: "09:00", end: "13:30" },
      TODAY,
    );
    expect(parsed).toMatchObject({ ok: true, value: { dateTo: "2026-09-25", start: 540, end: 810 } });
  });

  it("ошибки: порядок дат, время, прошлое, слишком длинный период", async () => {
    const { parseDatedBusy } = await import("@/core/dated");
    expect(parseDatedBusy({ ...base, dateTo: "2026-09-19" }, TODAY)).toEqual({ ok: false, error: "range_order" });
    expect(parseDatedBusy({ ...base, allDay: false, start: "14:00", end: "13:00" }, TODAY)).toEqual({ ok: false, error: "time" });
    expect(parseDatedBusy({ ...base, allDay: false, start: "", end: "13:00" }, TODAY)).toEqual({ ok: false, error: "time" });
    expect(parseDatedBusy({ ...base, dateFrom: "2025-09-20" }, TODAY)).toEqual({ ok: false, error: "past" });
    expect(parseDatedBusy({ ...base, dateTo: "2027-12-31" }, TODAY)).toEqual({ ok: false, error: "range_long" });
    expect(parseDatedBusy({ ...base, dateFrom: "20.09.2026" }, TODAY)).toEqual({ ok: false, error: "date" });
  });

  it("добавленная занятость видна в списке, удаляется только своя", async () => {
    const { repo } = await mods();
    const me = await repo.createWebUser({ fullName: "Я", lang: "ru" });
    const other = await repo.createWebUser({ fullName: "Другой", lang: "ru" });
    await repo.replaceWeeklySlots(me.userId, [0], [{ weekday: 0, start: 540, end: 600 }], "web");
    await repo.addRangeSlot({ userId: me.userId, dateFrom: "2026-10-05", dateTo: "2026-10-09", start: 0, end: 1440 });
    await repo.addDatedSlot({ userId: me.userId, day: "2026-10-01", start: 600, end: 700, label: "Отработка" });

    const dated = await repo.datedSlots(me.userId);
    expect(dated.map((slot) => slot.specificDate ?? slot.dateFrom)).toEqual(["2026-10-01", "2026-10-05"]);

    expect(await repo.deleteSlot(other.userId, dated[0].id)).toBe(false);
    expect(await repo.deleteSlot(me.userId, dated[0].id)).toBe(true);
    expect(await repo.datedSlots(me.userId)).toHaveLength(1);
    // Недельное расписание не задето.
    expect((await repo.getSlots(me.userId)).filter((slot) => slot.weekday !== null)).toHaveLength(1);
  });
});

describe("голосование в Telegram из личной копии карточки", () => {
  it("голос из лички перерисовывает общую карточку, «изменить» спрашивает в личке", async () => {
    const { repo } = await mods();
    const { handleUpdate } = await import("@/bot/router");
    const chat = await repo.upsertChat(-100777000444, "ТГ личка");
    const amir = await telegramMember(chat.chatId, "Амир");
    const asel = await telegramMember(chat.chatId, "Асель");
    const meeting = await repo.createMeeting({
      chatId: chat.chatId,
      initiatorId: amir.userId,
      place: "Кафе",
      whenText: "пт",
      goal: "Личка",
      invitees: [amir.userId, asel.userId],
    });
    await repo.updateMeeting(meeting.id, { chatMessageId: 555 });

    const privateChat = { id: asel.userId, type: "private" as const };
    const press = (data: string) =>
      handleUpdate({
        update_id: 1,
        callback_query: {
          id: "cb",
          from: { id: asel.userId, is_bot: false, first_name: "Асель" },
          data,
          message: { message_id: 42, chat: privateChat, date: 0 },
        },
      });

    await press(`vote:${meeting.id}:yes`);
    const edits = stub.of("editMessageText").map((call) => [call.payload.chat_id, call.payload.message_id]);
    expect(edits).toContainEqual([asel.userId, 42]);
    expect(edits).toContainEqual([chat.chatId, 555]);

    stub.reset();
    await press(`vote:${meeting.id}:change`);
    const prompt = stub.last("sendMessage");
    expect(prompt?.payload.chat_id).toBe(asel.userId);
    expect(String(prompt?.payload.text)).not.toContain("tg://user");
  });

  it("администратор Telegram-чата может отменить чужую встречу", async () => {
    const { repo } = await mods();
    const { handleUpdate } = await import("@/bot/router");
    const chat = await repo.upsertChat(-100777000555, "ТГ отмена админом");
    const author = await telegramMember(chat.chatId, "Автор");
    const boss = await telegramMember(chat.chatId, "Админ");
    const meeting = await repo.createMeeting({
      chatId: chat.chatId,
      initiatorId: author.userId,
      place: "",
      whenText: "",
      goal: "Чужая",
      invitees: [author.userId, boss.userId],
    });
    stub.adminIds = [boss.userId];

    await handleUpdate({
      update_id: 2,
      callback_query: {
        id: "cb2",
        from: { id: boss.userId, is_bot: false, first_name: "Админ" },
        data: `card:cancel:${meeting.id}`,
        message: { message_id: 43, chat: { id: chat.chatId, type: "supergroup", title: "ТГ" }, date: 0 },
      },
    });
    expect((await repo.getMeeting(meeting.id))?.status).toBe("cancelled");
  });
});
