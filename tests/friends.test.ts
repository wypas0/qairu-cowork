/**
 * Друзья: правила «можно ли» (чистые функции) и вся цепочка lib/friends на
 * настоящем Postgres — заявки, ссылки, блокировки, группы друга, приглашения
 * и просьбы вступить, кнопки бота. Каждый запрет — отдельный тест: именно
 * они держат систему закрытой (чужой id в форме, мёртвое приглашение,
 * скрытая группа, заблокированный).
 */

import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { TgUpdate } from "@/bot/api";
import * as core from "@/core/friends";
import type { User } from "@/db/schema";
import { CODE_ALPHABET } from "@/lib/invite";
import { startTestDb } from "./support/db";
import { installTelegramStub, type TelegramStub } from "./support/telegram";

const DAY = 86_400_000;
const NOW = new Date("2026-10-22T09:00:00Z");

// --------------------------------------------------------------------------
// Правила
// --------------------------------------------------------------------------

const rel = (patch: Partial<core.Relation> = {}): core.Relation => ({ ...core.NO_RELATION, ...patch });
const counts = { myFriends: 3, theirFriends: 3, myPendingOut: 0 };

describe("правила друзей", () => {
  it("пара хранится меньшим id вперёд", () => {
    expect(core.pairOf(5, 2)).toEqual([2, 5]);
    expect(core.pairOf(-7, 3)).toEqual([-7, 3]);
  });

  it("заявка: себе, заблокированному, другу и повторно — нельзя", () => {
    expect(core.requestVerdict(rel({ self: true }), counts, NOW)).toEqual({ ok: false, reason: "self" });
    expect(core.requestVerdict(rel({ blockedByMe: true }), counts, NOW)).toEqual({ ok: false, reason: "blocked" });
    expect(core.requestVerdict(rel({ friends: true }), counts, NOW)).toEqual({ ok: false, reason: "friends" });
    expect(core.requestVerdict(rel({ outgoing: true }), counts, NOW)).toEqual({ ok: false, reason: "pending" });
  });

  it("встречная заявка — сразу дружба, а не вторая заявка", () => {
    expect(core.requestVerdict(rel({ incoming: true }), counts, NOW)).toEqual({ ok: true, accept: true, silent: false });
  });

  it("меня заблокировали — заявка «уходит» молча, о блокировке не узнать", () => {
    expect(core.requestVerdict(rel({ blockedMe: true }), counts, NOW)).toEqual({ ok: true, accept: false, silent: true });
    // Даже встречная заявка от заблокировавшего не превращается в дружбу.
    expect(core.requestVerdict(rel({ blockedMe: true, incoming: true }), counts, NOW)).toEqual({
      ok: true,
      accept: false,
      silent: true,
    });
  });

  it("после отказа — неделя паузы", () => {
    const declined = (days: number) => rel({ declinedAt: new Date(NOW.getTime() - days * DAY) });
    expect(core.requestVerdict(declined(6), counts, NOW)).toEqual({ ok: false, reason: "cooldown" });
    expect(core.requestVerdict(declined(8), counts, NOW)).toMatchObject({ ok: true });
  });

  it("пределы друзей и ждущих заявок", () => {
    const max = core.FRIEND_LIMITS.maxFriends;
    expect(core.requestVerdict(rel(), { ...counts, myFriends: max }, NOW)).toEqual({ ok: false, reason: "too_many_friends" });
    expect(core.requestVerdict(rel(), { ...counts, theirFriends: max }, NOW)).toEqual({ ok: false, reason: "too_many_friends" });
    expect(core.requestVerdict(rel(), { ...counts, myPendingOut: core.FRIEND_LIMITS.maxPendingOut }, NOW)).toEqual({
      ok: false,
      reason: "too_many_pending",
    });
  });

  it("ссылка заблокировавшего «не работает», как устаревшая", () => {
    expect(core.linkVerdict(rel({ blockedMe: true }), counts)).toEqual({ ok: false, reason: "invalid" });
    expect(core.linkVerdict(rel({ self: true }), counts)).toEqual({ ok: false, reason: "self" });
    expect(core.linkVerdict(rel(), counts)).toEqual({ ok: true });
  });

  it("группы и свободное время видит только друг без блокировок и с согласия", () => {
    expect(core.canSeeGroups(rel({ friends: true }), { friendsSeeGroups: true })).toBe(true);
    expect(core.canSeeGroups(rel({ friends: true }), { friendsSeeGroups: false })).toBe(false);
    expect(core.canSeeGroups(rel(), { friendsSeeGroups: true })).toBe(false);
    expect(core.canSeeGroups(rel({ friends: true, blockedMe: true }), { friendsSeeGroups: true })).toBe(false);
    const on = { friendsSeeFree: true };
    expect(core.canSeeFreeTime(rel({ friends: true }), on, on)).toBe(true);
    expect(core.canSeeFreeTime(rel({ friends: true }), on, { friendsSeeFree: false })).toBe(false);
    expect(core.canSeeFreeTime(rel({ friends: true }), { friendsSeeFree: false }, on)).toBe(false);
  });

  it("позвать в группу: только участник, только друга, кого там нет", () => {
    const base = { rel: rel({ friends: true }), inviterIsMember: true, inviteeIsMember: false, pending: false };
    expect(core.inviteVerdict(base)).toEqual({ ok: true });
    expect(core.inviteVerdict({ ...base, inviterIsMember: false })).toEqual({ ok: false, reason: "not_member" });
    expect(core.inviteVerdict({ ...base, rel: rel() })).toEqual({ ok: false, reason: "not_friend" });
    expect(core.inviteVerdict({ ...base, rel: rel({ friends: true, blockedMe: true }) })).toEqual({ ok: false, reason: "blocked" });
    expect(core.inviteVerdict({ ...base, inviteeIsMember: true })).toEqual({ ok: false, reason: "already_member" });
    expect(core.inviteVerdict({ ...base, pending: true })).toEqual({ ok: false, reason: "pending" });
  });

  it("попроситься: только в видимую группу друга", () => {
    const base = { rel: rel({ friends: true }), groupVisible: true, friendIsMember: true, askerIsMember: false, pending: false };
    expect(core.askVerdict(base)).toEqual({ ok: true });
    expect(core.askVerdict({ ...base, groupVisible: false })).toEqual({ ok: false, reason: "hidden" });
    expect(core.askVerdict({ ...base, friendIsMember: false })).toEqual({ ok: false, reason: "not_member" });
    expect(core.askVerdict({ ...base, rel: rel() })).toEqual({ ok: false, reason: "not_friend" });
    expect(core.askVerdict({ ...base, askerIsMember: true })).toEqual({ ok: false, reason: "already_member" });
  });

  it("ответ на приглашение проверяется заново", () => {
    const invite = { kind: "invite", status: "pending", fromUser: 1, toUser: 2, expiresAt: new Date(NOW.getTime() + DAY) };
    const base = { invite, me: 2, accept: true, now: NOW, hostIsMember: true, joinerIsMember: false, blocked: false };
    expect(core.inviteAnswerVerdict(base)).toEqual({ ok: true });
    expect(core.inviteAnswerVerdict({ ...base, invite: null })).toEqual({ ok: false, reason: "gone" });
    expect(core.inviteAnswerVerdict({ ...base, invite: { ...invite, status: "accepted" } })).toEqual({ ok: false, reason: "gone" });
    expect(core.inviteAnswerVerdict({ ...base, me: 3 })).toEqual({ ok: false, reason: "not_yours" });
    expect(core.inviteAnswerVerdict({ ...base, invite: { ...invite, expiresAt: NOW } })).toEqual({ ok: false, reason: "expired" });
    expect(core.inviteAnswerVerdict({ ...base, hostIsMember: false })).toEqual({ ok: false, reason: "inviter_left" });
    expect(core.inviteAnswerVerdict({ ...base, joinerIsMember: true })).toEqual({ ok: false, reason: "already_member" });
    expect(core.inviteAnswerVerdict({ ...base, blocked: true })).toEqual({ ok: false, reason: "blocked" });
    // Отказаться можно, даже если пригласивший уже ушёл.
    expect(core.inviteAnswerVerdict({ ...base, accept: false, hostIsMember: false })).toEqual({ ok: true });
  });

  it("код ссылки: алфавит кодов групп, без перекоса, разбор из ссылки и параметра", () => {
    expect(core.FRIEND_CODE_ALPHABET).toBe(CODE_ALPHABET);
    // Байты ≥ 240 отбрасываются: иначе первые буквы алфавита выпадали бы чаще.
    let call = 0;
    const code = core.newFriendCode((n) => {
      call += 1;
      return Uint8Array.from({ length: n }, (_, index) => (index % 2 === 0 ? 250 : index));
    });
    expect(code).toHaveLength(core.FRIEND_CODE_LENGTH);
    expect([...code].every((char) => CODE_ALPHABET.includes(char))).toBe(true);
    expect(call).toBe(1);

    expect(core.normalizeFriendCode("https://site.kz/f/ABCDEFGH23")).toBe("abcdefgh23");
    expect(core.normalizeFriendCode("f_abcdefgh23")).toBe("abcdefgh23");
    expect(core.normalizeFriendCode("abcd efgh 23")).toBe("abcdefgh23");
    expect(core.normalizeFriendCode("abcdefgh0o")).toBeNull(); // 0 и o в алфавит не входят
    expect(core.normalizeFriendCode("short")).toBeNull();
  });

  it("ник: @, ссылка t.me и регистр — к одному виду; мусор — null", () => {
    expect(core.normalizeUsername("@Asel_N")).toBe("asel_n");
    expect(core.normalizeUsername("https://t.me/asel_n")).toBe("asel_n");
    expect(core.normalizeUsername("as")).toBeNull();
    expect(core.normalizeUsername("asel n")).toBeNull();
    expect(core.normalizeUsername("1asel")).toBeNull();
  });
});

// --------------------------------------------------------------------------
// Вся цепочка на базе
// --------------------------------------------------------------------------

let db: PGlite;
let stub: TelegramStub;

async function mods() {
  return {
    repo: await import("@/db/repo"),
    friends: await import("@/lib/friends"),
    router: await import("@/bot/router"),
  };
}

async function person(id: number, username: string | null, extra: { findable?: boolean; isWeb?: boolean } = {}): Promise<User> {
  await db.query("insert into users (user_id, username, full_name, lang, is_web, findable) values ($1, $2, $3, 'ru', $4, $5)", [
    id,
    username,
    `Человек ${id}`,
    extra.isWeb ?? false,
    extra.findable ?? true,
  ]);
  return (await (await mods()).repo.getUser(id))!;
}

async function group(chatId: number, title: string, members: [number, { hidden?: boolean; role?: string }?][]) {
  await db.query("insert into chats (chat_id, slug, origin, title) values ($1, $2, 'web', $3)", [chatId, `g${-chatId}`, title]);
  for (const [userId, options] of members) {
    await db.query("insert into memberships (chat_id, user_id, role, hidden_from_friends) values ($1, $2, $3, $4)", [
      chatId,
      userId,
      options?.role ?? "member",
      options?.hidden ?? false,
    ]);
  }
  return (await (await mods()).repo.getChat(chatId))!;
}

/** Сделать двоих друзьями напрямую — для сценариев, где важна не заявка. */
async function befriend(a: number, b: number) {
  await (await mods()).repo.addFriendship(a, b);
}

const dmsTo = (userId: number) => stub.of("sendMessage").filter((call) => call.payload.chat_id === userId);

beforeAll(async () => {
  process.env.BOT_TOKEN = "123456:AAHtestTOKENtestTOKENtestTOKENtestTO";
  process.env.NEXT_PUBLIC_SITE_URL = "https://qairu.example";
  stub = installTelegramStub();
  db = await startTestDb();
});

beforeEach(() => stub.reset());

describe("заявки в друзья", () => {
  it("по нику → встречная заявка → дружба; бот присылает кнопки", async () => {
    const { friends, repo } = await mods();
    const a = await person(6101, "amir_f");
    const b = await person(6102, "asel_f");

    expect(await friends.requestByUsername(a, "@Asel_F")).toBe("sent");
    const dm = dmsTo(b.userId)[0]!;
    expect(String(dm.payload.text)).toContain("amir_f");
    const buttons = JSON.stringify(dm.payload.reply_markup);
    expect(buttons).toMatch(/fr:a:\d+/);
    expect(buttons).toMatch(/fr:d:\d+/);
    // Повторная заявка не плодит вторую.
    expect(await friends.requestByUsername(a, "asel_f")).toBe("pending");

    expect(await friends.requestByUsername(b, "amir_f")).toBe("friends_now");
    expect(await repo.areFriends(a.userId, b.userId)).toBe(true);
    expect(await friends.requestByUsername(a, "asel_f")).toBe("friends");
    expect((await repo.incomingRequests(a.userId)).length).toBe(0);
  });

  it("поиск не находит скрывшихся, веб-аккаунты и не путает с собой", async () => {
    const { friends } = await mods();
    const me = await person(6111, "finder_x");
    await person(6112, "hidden_x", { findable: false });
    await person(-(10 ** 15) - 6113, "webby_x", { isWeb: true });
    expect((await friends.searchByUsername(me, "hidden_x")).code).toBe("none");
    expect((await friends.searchByUsername(me, "webby_x")).code).toBe("none");
    expect((await friends.searchByUsername(me, "finder_x")).code).toBe("self");
    expect((await friends.searchByUsername(me, "!!")).code).toBe("bad");
    expect((await friends.requestByUsername(me, "hidden_x"))).toBe("none");
  });

  it("одногруппника можно позвать из «Участников», постороннего по id — нельзя", async () => {
    const { friends } = await mods();
    const a = await person(6121, "mate_a");
    const b = await person(6122, "mate_b", { findable: false });
    const stranger = await person(6123, "stranger_c", { findable: false });
    await group(-6121, "Общая", [[a.userId], [b.userId]]);
    expect(await friends.requestGroupmate(a, b.userId)).toBe("sent");
    expect(await friends.requestGroupmate(a, stranger.userId)).toBe("none");
  });

  it("отказ: неделя паузы, потом можно снова", async () => {
    const { friends, repo } = await mods();
    const a = await person(6131, "pause_a");
    const b = await person(6132, "pause_b");
    expect(await friends.requestByUsername(a, "pause_b")).toBe("sent");
    const [request] = await repo.incomingRequests(b.userId);
    expect((await friends.answerFriendRequest(b, request!.request.id, false)).code).toBe("declined");
    expect(await friends.requestByUsername(a, "pause_b")).toBe("cooldown");
    await db.query("update friend_requests set decided_at = now() - interval '8 days' where id = $1", [request!.request.id]);
    expect(await friends.requestByUsername(a, "pause_b")).toBe("sent");
  });

  it("чужую заявку не принять, подставив её номер", async () => {
    const { friends, repo } = await mods();
    const a = await person(6141, "idor_a");
    await person(6142, "idor_b");
    const thief = await person(6143, "idor_c");
    expect(await friends.requestByUsername(a, "idor_b")).toBe("sent");
    const [request] = await repo.outgoingRequests(a.userId);
    expect((await friends.answerFriendRequest(thief, request!.request.id, true)).code).toBe("gone");
    expect(await repo.areFriends(a.userId, thief.userId)).toBe(false);
    expect(await repo.areFriends(a.userId, 6142)).toBe(false);
    // Отозвать чужую заявку тоже нельзя.
    expect(await friends.cancelRequest(thief, request!.request.id)).toBe("gone");
  });

  it("не больше 20 заявок в сутки", async () => {
    const { friends } = await mods();
    const spammer = await person(6151, "spam_me");
    await db.exec(
      "insert into users (user_id, username, full_name) select 6200 + g, 'target' || g, 'T' from generate_series(1, 21) g",
    );
    const results = [];
    for (let index = 1; index <= 21; index += 1) results.push(await friends.requestByUsername(spammer, `target${index}`));
    expect(results.slice(0, 20).every((result) => result === "sent")).toBe(true);
    expect(results[20]).toBe("throttled");
  });
});

describe("блокировка", () => {
  it("дружба рвётся, заявки гаснут, заблокированный ни о чём не узнаёт", async () => {
    const { friends, repo } = await mods();
    const a = await person(6301, "block_a");
    const b = await person(6302, "block_b");
    await befriend(a.userId, b.userId);
    const code = await friends.friendCodeOf(b);

    expect(await friends.blockUser(b, a.userId)).toBe("blocked_done");
    expect(await repo.areFriends(a.userId, b.userId)).toBe(false);

    stub.reset();
    // Он думает, что заявка ушла, — но её никто не увидит и бот промолчит.
    expect(await friends.requestByUsername(a, "block_b")).toBe("sent");
    expect(dmsTo(b.userId)).toEqual([]);
    expect(await repo.incomingRequests(b.userId)).toEqual([]);
    expect(await repo.friendBadge(b.userId, new Date())).toBe(0);
    // Ссылка заблокировавшего для него «не работает».
    expect((await friends.addByLink(a, code)).code).toBe("invalid");
    // А сам заблокировавший не может написать, пока не разблокирует.
    expect(await friends.requestByUsername(b, "block_a")).toBe("blocked");

    expect(await friends.unblockUser(b, a.userId)).toBe("unblocked");
    expect(await friends.blockUser(b, b.userId)).toBe("self");
  });
});

describe("личная ссылка", () => {
  it("сразу дружба и уведомление владельцу; смена гасит старую ссылку", async () => {
    const { friends, repo } = await mods();
    const owner = await person(6401, "link_owner");
    const guest = await person(6402, "link_guest");
    const late = await person(6403, "link_late");
    const code = await friends.friendCodeOf(owner);
    expect(await friends.friendCodeOf(owner)).toBe(code);

    expect((await friends.addByLink(guest, `https://site/f/${code}`)).code).toBe("friends_now");
    expect(await repo.areFriends(owner.userId, guest.userId)).toBe(true);
    expect(String(dmsTo(owner.userId)[0]?.payload.text)).toContain("link_guest");
    expect((await friends.addByLink(guest, code)).code).toBe("already");
    expect((await friends.addByLink(owner, code)).code).toBe("self");

    expect(await friends.rotateFriendCode(owner)).toBe("rotated");
    expect((await friends.addByLink(late, code)).code).toBe("invalid");
    expect((await friends.addByLink(late, await friends.friendCodeOf(owner))).code).toBe("friends_now");
  });
});

describe("группы друга", () => {
  it("видны его группы без скрытых, ссылка — только на общие", async () => {
    const { friends, repo } = await mods();
    const a = await person(6501, "groups_a");
    const b = await person(6502, "groups_b");
    await group(-6501, "Общая", [[a.userId], [b.userId]]);
    await group(-6502, "Кружок", [[b.userId, { role: "admin" }]]);
    await group(-6503, "Секрет", [[b.userId, { hidden: true }]]);

    // Не друзья — ничего.
    expect((await friends.friendGroups(a, b)).visible).toBe(false);
    await befriend(a.userId, b.userId);
    const view = await friends.friendGroups(a, b);
    expect(view.visible).toBe(true);
    expect(view.groups.map((g) => [g.title, g.mine, g.slug])).toEqual([
      ["Кружок", false, null],
      ["Общая", true, "g6501"],
    ]);

    await repo.setFriendSettings(b.userId, { friendsSeeGroups: false });
    const hidden = await friends.friendGroups(a, (await repo.getUser(b.userId))!);
    expect(hidden).toEqual({ visible: false, groups: [] });
  });
});

describe("приглашения в группы", () => {
  it("зовёт участник своих друзей; без дублей; принял — в группе, пригласившему сообщение", async () => {
    const { friends, repo } = await mods();
    const host = await person(6601, "inv_host");
    const friend = await person(6602, "inv_friend");
    const stranger = await person(6603, "inv_stranger");
    const outsider = await person(6604, "inv_outsider");
    const chat = await group(-6601, "Мой проект", [[host.userId, { role: "admin" }]]);
    await befriend(host.userId, friend.userId);
    await befriend(outsider.userId, friend.userId);

    const first = await friends.inviteFriends(host, chat, [friend.userId, stranger.userId, host.userId]);
    expect(first).toEqual({ code: "sent", sent: 1 });
    expect(JSON.stringify(dmsTo(friend.userId)[0]?.payload.reply_markup)).toMatch(/gi:a:\d+/);
    expect(await friends.inviteFriends(host, chat, [friend.userId])).toEqual({ code: "none", sent: 0 });
    // Не участник позвать не может, даже своего друга.
    expect((await friends.inviteFriends(outsider, chat, [friend.userId])).code).toBe("not_member");

    const [entry] = await repo.incomingInvites(friend.userId, "invite", new Date());
    stub.reset();
    const answer = await friends.answerGroupInvite(friend, entry!.invite.id, true);
    expect(answer.code).toBe("joined");
    expect(await repo.isMember(chat.chatId, friend.userId)).toBe(true);
    expect(String(dmsTo(host.userId)[0]?.payload.text)).toContain("Мой проект");
  });

  it("принять нельзя: пригласивший ушёл, срок вышел, приглашение не тебе", async () => {
    const { friends, repo } = await mods();
    const host = await person(6701, "late_host");
    const friend = await person(6702, "late_friend");
    const other = await person(6703, "late_other");
    const chat = await group(-6701, "Уходящая", [[host.userId]]);
    await befriend(host.userId, friend.userId);
    await befriend(host.userId, other.userId);

    await friends.inviteFriends(host, chat, [friend.userId, other.userId]);
    const [invite] = await repo.incomingInvites(friend.userId, "invite", new Date());
    expect((await friends.answerGroupInvite(other, invite!.invite.id, true)).code).toBe("not_yours");

    const [otherInvite] = await repo.incomingInvites(other.userId, "invite", new Date());
    await db.query("update group_invites set expires_at = now() - interval '1 minute' where id = $1", [otherInvite!.invite.id]);
    expect((await friends.answerGroupInvite(other, otherInvite!.invite.id, true)).code).toBe("expired");
    expect(await repo.isMember(chat.chatId, other.userId)).toBe(false);

    await repo.removeMembership(chat.chatId, host.userId);
    // Ушедший хозяин — приглашение пропадает из списка и не впускает.
    expect(await repo.incomingInvites(friend.userId, "invite", new Date())).toEqual([]);
    expect((await friends.answerGroupInvite(friend, invite!.invite.id, true)).code).toBe("inviter_left");
    expect(await repo.isMember(chat.chatId, friend.userId)).toBe(false);
  });

  it("попроситься: только в видимую группу; участник впускает одним нажатием", async () => {
    const { friends, repo } = await mods();
    const asker = await person(6801, "ask_asker");
    const member = await person(6802, "ask_member");
    const open = await group(-6801, "Открытая", [[member.userId]]);
    const secret = await group(-6802, "Скрытая", [[member.userId, { hidden: true }]]);
    expect(await friends.askToJoin(asker, member.userId, open.chatId)).toBe("not_friend");
    await befriend(asker.userId, member.userId);

    expect(await friends.askToJoin(asker, member.userId, secret.chatId)).toBe("hidden");
    expect(await friends.askToJoin(asker, member.userId, open.chatId)).toBe("asked");
    expect(await friends.askToJoin(asker, member.userId, open.chatId)).toBe("pending");
    expect(JSON.stringify(dmsTo(member.userId).at(-1)?.payload.reply_markup)).toMatch(/ga:a:\d+/);

    const [ask] = await repo.incomingInvites(member.userId, "ask", new Date());
    expect(await repo.friendBadge(member.userId, new Date())).toBe(1);
    expect((await friends.answerGroupInvite(member, ask!.invite.id, true)).code).toBe("approved");
    expect(await repo.isMember(open.chatId, asker.userId)).toBe(true);
    expect(await friends.askToJoin(asker, member.userId, open.chatId)).toBe("already_member");
  });

  it("консоль владельца видит только числа за сутки", async () => {
    const { repo } = await mods();
    // Блокировку из сценария выше сняли — считается только действующая.
    await repo.addBlock(6801, 6802);
    const stats = await repo.friendStats(new Date(Date.now() - DAY));
    // Сценарии выше: заявки, вход по ссылке, приглашения, просьбы.
    expect(stats.requests).toBeGreaterThan(20);
    expect(stats.viaLink).toBe(2);
    expect(stats.invites).toBeGreaterThan(0);
    expect(stats.asks).toBe(1);
    expect(stats.joined).toBeGreaterThan(0);
    expect(stats.blocks).toBe(1);
  });
});

describe("бот: кнопки под уведомлениями", () => {
  /** Нажатие кнопки человеком из базы — в личке с ботом. */
  function press(who: User, data: string): TgUpdate {
    return {
      update_id: 1,
      callback_query: {
        id: `cb-${data}`,
        from: { id: who.userId, is_bot: false, first_name: "X" },
        data,
        message: { message_id: 77, chat: { id: who.userId, type: "private" }, date: 0 },
      },
    } as TgUpdate;
  }

  it("принять заявку может только адресат", async () => {
    const { friends, repo, router } = await mods();
    const a = await person(6901, "bot_a");
    const b = await person(6902, "bot_b");
    const c = await person(6903, "bot_c");
    await friends.requestByUsername(a, "bot_b");
    const [request] = await repo.incomingRequests(b.userId);

    stub.reset();
    await router.handleUpdate(press(c, `fr:a:${request!.request.id}`));
    expect(await repo.areFriends(a.userId, b.userId)).toBe(false);
    expect(await repo.areFriends(a.userId, c.userId)).toBe(false);

    await router.handleUpdate(press(b, `fr:a:${request!.request.id}`));
    expect(await repo.areFriends(a.userId, b.userId)).toBe(true);
    expect(String(stub.last("editMessageText")?.payload.text)).toContain("bot_a");
    // Отправителю — что заявку приняли.
    expect(dmsTo(a.userId).length).toBe(1);
  });

  it("вступить по кнопке приглашения", async () => {
    const { friends, repo, router } = await mods();
    const host = await person(6911, "bot_host");
    const friend = await person(6912, "bot_friend");
    const chat = await group(-6911, "Кнопочная", [[host.userId]]);
    await befriend(host.userId, friend.userId);
    await friends.inviteFriends(host, chat, [friend.userId]);
    const [entry] = await repo.incomingInvites(friend.userId, "invite", new Date());
    await router.handleUpdate(press(friend, `gi:a:${entry!.invite.id}`));
    expect(await repo.isMember(chat.chatId, friend.userId)).toBe(true);
    expect(String(stub.last("editMessageText")?.payload.text)).toContain("Кнопочная");
  });
});

describe("общее свободное время", () => {
  it("только друзьям, только окна и только с согласия обоих", async () => {
    const { friends, repo } = await mods();
    const a = await person(7001, "free_a");
    const b = await person(7002, "free_b");
    const now = new Date("2026-10-19T03:00:00Z"); // понедельник, 08:00 в Алматы

    expect((await friends.freeTogether(a, b, now)).status).toBe("hidden");
    await befriend(a.userId, b.userId);
    expect(await friends.freeTogether(a, b, now)).toEqual({ status: "missing", me: true, friend: true });

    // Оба заняты по понедельникам 8–12 и 12–18 соответственно: общее окно — 18–22.
    await db.exec(`
      insert into busy_slots (user_id, weekday, start_min, end_min, kind, source) values
        (${a.userId}, 0, 480, 720, 'class', 'web'), (${b.userId}, 0, 720, 1080, 'class', 'web');
      insert into schedule_state (user_id, filled) values (${a.userId}, true), (${b.userId}, true);
    `);
    const free = await friends.freeTogether(a, b, now);
    expect(free.status).toBe("ok");
    if (free.status !== "ok") return;
    expect(free.days[0]).toEqual({ day: "2026-10-19", windows: [[1080, 1320]] });
    // Две недели по дням, и без общих окон тоже: полоска дня рисует каждый.
    expect(free.days.map((entry) => entry.day)).toEqual([
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
    ]);

    await repo.setFriendSettings(b.userId, { friendsSeeFree: false });
    expect((await friends.freeTogether(a, (await repo.getUser(b.userId))!, now)).status).toBe("hidden");
  });
});

describe("«Вернуть» после отказа", () => {
  it("заявка снова ждёт ответа — только у адресата и только сразу после отказа", async () => {
    const { friends, repo } = await mods();
    const a = await person(7201, "undo_a");
    const b = await person(7202, "undo_b");
    const thief = await person(7203, "undo_c");
    expect(await friends.requestByUsername(a, "undo_b")).toBe("sent");
    const [request] = await repo.incomingRequests(b.userId);
    const id = request!.request.id;
    expect((await friends.answerFriendRequest(b, id, false)).code).toBe("declined");

    // Чужой номер заявки ничего не возвращает.
    expect(await friends.undoDecline(thief, "fr", id)).toBe("gone");
    expect(await friends.undoDecline(b, "fr", id)).toBe("restored");
    expect((await repo.incomingRequests(b.userId)).map((entry) => entry.request.id)).toEqual([id]);
    // Будто отказа не было: недельной паузы нет, заявка просто ждёт.
    expect(await friends.requestByUsername(a, "undo_b")).toBe("pending");
    // Второй раз вернуть нечего — заявка уже ждёт.
    expect(await friends.undoDecline(b, "fr", id)).toBe("gone");

    // Через минуту после отказа — поздно.
    expect((await friends.answerFriendRequest(b, id, false)).code).toBe("declined");
    expect(await friends.undoDecline(b, "fr", id, new Date(Date.now() + 61_000))).toBe("gone");
    expect(await repo.incomingRequests(b.userId)).toEqual([]);
  });

  it("приглашение в группу — пока не истёк срок", async () => {
    const { friends, repo } = await mods();
    const host = await person(7211, "undo_host");
    const friend = await person(7212, "undo_friend");
    const chat = await group(-7211, "Возвратная", [[host.userId]]);
    await befriend(host.userId, friend.userId);
    await friends.inviteFriends(host, chat, [friend.userId]);
    const [invite] = await repo.incomingInvites(friend.userId, "invite", new Date());
    const id = invite!.invite.id;

    expect((await friends.answerGroupInvite(friend, id, false)).code).toBe("declined");
    expect(await friends.undoDecline(host, "gi", id)).toBe("gone");
    expect(await friends.undoDecline(friend, "gi", id)).toBe("restored");
    expect((await repo.incomingInvites(friend.userId, "invite", new Date())).map((entry) => entry.invite.id)).toEqual([id]);

    expect((await friends.answerGroupInvite(friend, id, false)).code).toBe("declined");
    await db.query("update group_invites set expires_at = now() - interval '1 minute' where id = $1", [id]);
    expect(await friends.undoDecline(friend, "gi", id)).toBe("gone");
  });
});
