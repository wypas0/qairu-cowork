/**
 * Друзья — единственная дверь для сайта и бота.
 *
 * Каждое действие здесь: собрать из базы, как связаны люди, спросить правила
 * (core/friends), записать в транзакции и разослать уведомление. Права
 * проверяются заново на каждом шаге и по людям из базы, а не по тому, что
 * пришло в форме или в кнопке: подставить чужой id бесполезно.
 *
 * Ответ — короткий код исхода; сайт превращает его в тост, бот — в ответ на
 * кнопку.
 */

import "server-only";

import crypto from "node:crypto";

import { computeAvailability } from "@/core/availability";
import {
  type AskRefusal,
  FRIEND_LIMITS,
  type InviteAnswerRefusal,
  type InviteRefusal,
  type Relation,
  type RequestRefusal,
  askVerdict,
  canSeeFreeTime,
  canSeeGroups,
  inviteAnswerVerdict,
  inviteExpiry,
  inviteVerdict,
  linkVerdict,
  newFriendCode,
  normalizeFriendCode,
  normalizeUsername,
  requestVerdict,
} from "@/core/friends";
import type { Interval } from "@/core/intervals";
import { PAIR_PLAN } from "@/core/pairPlan";
import { type DateStr, todayIn, utcToZonedWall } from "@/core/timeutils";
import * as repo from "@/db/repo";
import type { Chat, User } from "@/db/schema";
import { defaultTz } from "./config";
import {
  notifyFriendAccepted,
  notifyFriendByLink,
  notifyFriendRequest,
  notifyGroupAsk,
  notifyGroupInvite,
  notifyJoinedByFriend,
} from "./friendNotify";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Не больше `limit` за окно — общий счётчик bot_state, как у отчётов расширения. */
async function overLimit(kind: string, userId: number, limit: number, windowMs: number): Promise<boolean> {
  return (await repo.bumpCounter(`fr:${kind}:${userId}`, windowMs)) > limit;
}

/** Как связаны двое — всё, что нужно правилам, одним заходом в базу. */
export async function relationOf(me: number, other: number): Promise<Relation> {
  if (me === other) {
    return { self: true, friends: false, blockedByMe: false, blockedMe: false, outgoing: false, incoming: false, declinedAt: null };
  }
  const [friends, blocks, pending, declinedAt] = await Promise.all([
    repo.areFriends(me, other),
    repo.blockState(me, other),
    repo.pendingRequestBetween(me, other),
    repo.lastDeclined(me, other),
  ]);
  return {
    self: false,
    friends,
    blockedByMe: blocks.byMe,
    blockedMe: blocks.byThem,
    outgoing: pending?.fromUser === me,
    incoming: pending?.fromUser === other,
    declinedAt,
  };
}

// --------------------------------------------------------------------------
// Заявки
// --------------------------------------------------------------------------

export type RequestOutcome = "sent" | "friends_now" | "throttled" | RequestRefusal;

/**
 * Заявка от `me` к `target`. Кто такой target, решает вызывающий: найден по
 * нику (findable) или это одногруппник (`via = group`) — см. requestBy*.
 */
async function sendRequest(me: User, target: User, via: "search" | "group"): Promise<RequestOutcome> {
  if (target.isWeb) return "self";
  if (await overLimit("req", me.userId, FRIEND_LIMITS.requestsPerDay, DAY)) return "throttled";
  const [rel, myFriends, theirFriends, myPendingOut] = await Promise.all([
    relationOf(me.userId, target.userId),
    repo.friendCount(me.userId),
    repo.friendCount(target.userId),
    repo.pendingOutCount(me.userId),
  ]);
  const verdict = requestVerdict(rel, { myFriends, theirFriends, myPendingOut }, new Date());
  if (!verdict.ok) return verdict.reason;

  if (verdict.accept) {
    // Он уже звал меня — это не новая заявка, а согласие.
    const incoming = await repo.pendingRequestBetween(me.userId, target.userId);
    if (incoming && (await acceptRequest(me, incoming.id))) {
      await notifyFriendAccepted(target, me);
      return "friends_now";
    }
    return "pending";
  }

  const request = await repo.createFriendRequest({ from: me.userId, to: target.userId, via });
  if (!request) return "pending";
  // Меня заблокировали: заявка лежит, но её никто не увидит и уведомления не будет.
  if (!verdict.silent) await notifyFriendRequest(target, me, request.id);
  return "sent";
}

export type SearchResult =
  | { code: "found"; user: User; rel: Relation }
  | { code: "none" | "bad" | "throttled" | "self" };

/**
 * Поиск по точному @нику среди тех, кто разрешил себя находить (решение
 * 22.10.2026: искать можно всех — общих групп в вузе нет). Подстрок нет,
 * поисков — не больше `lookupsPerHour` в час.
 */
export async function searchByUsername(me: User, query: string): Promise<SearchResult> {
  const username = normalizeUsername(query);
  if (!username) return { code: "bad" };
  if (await overLimit("find", me.userId, FRIEND_LIMITS.lookupsPerHour, HOUR)) return { code: "throttled" };
  const user = await repo.findableByUsername(username);
  if (!user) return { code: "none" };
  if (user.userId === me.userId) return { code: "self" };
  return { code: "found", user, rel: await relationOf(me.userId, user.userId) };
}

/** Заявка по нику: ник ищется заново, id из формы не берётся. */
export async function requestByUsername(me: User, query: string): Promise<RequestOutcome | "none" | "bad"> {
  const username = normalizeUsername(query);
  if (!username) return "bad";
  const user = await repo.findableByUsername(username);
  if (!user) return "none";
  return sendRequest(me, user, "search");
}

/** «В друзья» у одногруппника: только если группа действительно общая. */
export async function requestGroupmate(me: User, targetId: number): Promise<RequestOutcome | "none"> {
  const target = await repo.getUser(targetId);
  if (!target || target.isWeb || !(await repo.shareGroup(me.userId, targetId))) return "none";
  return sendRequest(me, target, "group");
}

/** Принять заявку (внутри — проверка «адресат — я» и лимита друзей). */
async function acceptRequest(me: User, requestId: number): Promise<User | null> {
  const request = await repo.getFriendRequest(requestId);
  if (!request || request.toUser !== me.userId || request.status !== "pending") return null;
  const [mine, theirs, blocks] = await Promise.all([
    repo.friendCount(me.userId),
    repo.friendCount(request.fromUser),
    repo.blockState(me.userId, request.fromUser),
  ]);
  if (blocks.byMe || blocks.byThem) return null;
  if (mine >= FRIEND_LIMITS.maxFriends || theirs >= FRIEND_LIMITS.maxFriends) return null;
  const done = await repo.transaction(async (tx) => {
    const decided = await repo.decideFriendRequest(requestId, me.userId, "accepted", tx);
    if (!decided) return false;
    await repo.addFriendship(me.userId, decided.fromUser, tx);
    return true;
  });
  return done ? repo.getUser(request.fromUser) : null;
}

export type AnswerOutcome = { code: "accepted" | "declined" | "gone"; other?: User };

/** Ответ на заявку — с сайта или кнопкой в боте. */
export async function answerFriendRequest(me: User, requestId: number, accept: boolean): Promise<AnswerOutcome> {
  if (accept) {
    const other = await acceptRequest(me, requestId);
    if (!other) return { code: "gone" };
    await notifyFriendAccepted(other, me);
    return { code: "accepted", other };
  }
  const declined = await repo.decideFriendRequest(requestId, me.userId, "declined");
  return { code: declined ? "declined" : "gone" };
}

/** Сколько после отказа ещё можно нажать «Вернуть»: тост живёт 5 секунд, запас — на медленную сеть. */
const UNDO_WINDOW_MS = 60_000;

/**
 * «Вернуть» после отказа — заявка или приглашение снова ждут ответа, будто
 * отказа не было (и недельной паузы после него тоже). Только своё и только
 * что отклонённое.
 */
export async function undoDecline(me: User, kind: "fr" | "gi", id: number, now = new Date()): Promise<"restored" | "gone"> {
  const since = new Date(now.getTime() - UNDO_WINDOW_MS);
  const restored =
    kind === "fr"
      ? await repo.restoreFriendRequest(id, me.userId, since)
      : await repo.restoreGroupInvite(id, me.userId, since, now);
  return restored ? "restored" : "gone";
}

export async function cancelRequest(me: User, requestId: number): Promise<"cancelled" | "gone"> {
  return (await repo.cancelFriendRequest(requestId, me.userId)) ? "cancelled" : "gone";
}

/** Удалить из друзей: заодно гаснут живые приглашения и встречи вдвоём между ними. */
export async function removeFriend(me: User, otherId: number): Promise<"removed" | "gone"> {
  return repo.transaction(async (tx) => {
    const removed = await repo.removeFriendship(me.userId, otherId, tx);
    if (removed) {
      await repo.cancelInvitesBetween(me.userId, otherId, tx);
      await repo.cancelPairMeetingsBetween(me.userId, otherId, tx);
    }
    return removed ? "removed" : "gone";
  });
}

/**
 * Заблокировать: дружба рвётся, живые заявки, приглашения и встречи вдвоём в
 * обе стороны гаснут. Заблокированному ничего не сообщается.
 */
export async function blockUser(me: User, otherId: number): Promise<"blocked_done" | "self" | "gone"> {
  if (otherId === me.userId) return "self";
  const other = await repo.getUser(otherId);
  if (!other) return "gone";
  await repo.transaction(async (tx) => {
    await repo.addBlock(me.userId, otherId, tx);
    await repo.removeFriendship(me.userId, otherId, tx);
    await repo.cancelRequestsBetween(me.userId, otherId, tx);
    await repo.cancelInvitesBetween(me.userId, otherId, tx);
    await repo.cancelPairMeetingsBetween(me.userId, otherId, tx);
  });
  return "blocked_done";
}

export async function unblockUser(me: User, otherId: number): Promise<"unblocked" | "gone"> {
  return (await repo.removeBlock(me.userId, otherId)) ? "unblocked" : "gone";
}

// --------------------------------------------------------------------------
// Личная ссылка
// --------------------------------------------------------------------------

const randomBytes = (n: number) => new Uint8Array(crypto.randomBytes(n));

async function issueCode(userId: number): Promise<string> {
  // Совпадение с чужим кодом при 30^10 вариантах почти невозможно, но не ноль.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = newFriendCode(randomBytes);
    if (await repo.setFriendLink(userId, code)) return code;
  }
  throw new Error("friend link: не удалось выдать код");
}

/** Код личной ссылки — заводится при первом показе. */
export async function friendCodeOf(me: User): Promise<string> {
  return (await repo.friendLinkOf(me.userId)) ?? issueCode(me.userId);
}

/** Сменить ссылку: старая перестаёт работать сразу. */
export async function rotateFriendCode(me: User): Promise<"rotated" | "throttled"> {
  if (await overLimit("code", me.userId, FRIEND_LIMITS.codeRotationsPerDay, DAY)) return "throttled";
  await issueCode(me.userId);
  return "rotated";
}

/** Чья это ссылка — для страницы /f/<код>. null — кода нет или он устарел. */
export async function linkOwner(code: string): Promise<User | null> {
  const clean = normalizeFriendCode(code);
  return clean ? repo.userByFriendCode(clean) : null;
}

export type LinkOutcome = "friends_now" | "already" | "self" | "blocked" | "invalid" | "too_many_friends" | "throttled";

/** Добавиться в друзья по ссылке: сразу дружба, владельцу — уведомление. */
export async function addByLink(me: User, code: string): Promise<{ code: LinkOutcome; owner?: User }> {
  const owner = await linkOwner(code);
  if (!owner) return { code: "invalid" };
  if (owner.userId === me.userId) return { code: "self" };
  if (await overLimit("req", me.userId, FRIEND_LIMITS.requestsPerDay, DAY)) return { code: "throttled" };
  const [rel, myFriends, theirFriends] = await Promise.all([
    relationOf(me.userId, owner.userId),
    repo.friendCount(me.userId),
    repo.friendCount(owner.userId),
  ]);
  const verdict = linkVerdict(rel, { myFriends, theirFriends });
  if (!verdict.ok) return verdict.reason === "friends" ? { code: "already", owner } : { code: verdict.reason };
  const added = await repo.transaction(async (tx) => {
    const fresh = await repo.addFriendship(me.userId, owner.userId, tx);
    if (fresh) {
      // Встречные заявки больше не нужны; сама ссылка — принятая заявка (для консоли).
      await repo.cancelRequestsBetween(me.userId, owner.userId, tx);
      await repo.createFriendRequest({ from: me.userId, to: owner.userId, via: "link", status: "accepted" }, tx);
    }
    return fresh;
  });
  if (!added) return { code: "already", owner };
  await notifyFriendByLink(owner, me);
  return { code: "friends_now", owner };
}

// --------------------------------------------------------------------------
// Группы друга
// --------------------------------------------------------------------------

export type FriendGroupView = {
  chatId: number;
  title: string;
  members: number;
  /** Я тоже в ней — тогда и только тогда известна ссылка на неё. */
  mine: boolean;
  slug: string | null;
  /** Я уже попросился и жду. */
  asked: boolean;
  /** Меня уже позвали — проситься незачем, осталось ответить. */
  invited: boolean;
};

/**
 * Группы друга, которые мне можно видеть. Код группы (он же адрес /g/…) —
 * пропуск в неё, поэтому slug отдаётся только для групп, где я и так состою.
 */
export async function friendGroups(
  me: User,
  friend: User,
  rel?: Relation,
): Promise<{ visible: boolean; groups: FriendGroupView[] }> {
  const relation = rel ?? (await relationOf(me.userId, friend.userId));
  if (!canSeeGroups(relation, friend)) return { visible: false, groups: [] };
  const now = new Date();
  const [groups, mine, asked, invites] = await Promise.all([
    repo.groupsOfUser(friend.userId),
    repo.chatIdsOf(me.userId),
    repo.pendingAsksFrom(me.userId, now),
    repo.incomingInvites(me.userId, "invite", now),
  ]);
  const invited = new Set(invites.map((entry) => entry.chat.chatId));
  return {
    visible: true,
    groups: groups
      .filter((group) => !group.hidden)
      .map((group) => ({
        chatId: group.chatId,
        title: group.title,
        members: group.members,
        mine: mine.has(group.chatId),
        slug: mine.has(group.chatId) ? group.slug : null,
        asked: asked.has(group.chatId),
        invited: invited.has(group.chatId),
      })),
  };
}

// --------------------------------------------------------------------------
// Приглашения в группы
// --------------------------------------------------------------------------

export type InviteOutcome = { code: "sent" | "none" | "throttled" | "not_member"; sent: number };

/**
 * Позвать друзей в группу. Звать может любой участник (решение 22.10.2026),
 * но только своих друзей; каждый проверяется отдельно, лишние пропускаются.
 */
export async function inviteFriends(me: User, chat: Chat, friendIds: number[]): Promise<InviteOutcome> {
  if (!(await repo.isMember(chat.chatId, me.userId))) return { code: "not_member", sent: 0 };
  const wanted = [...new Set(friendIds)].filter((id) => Number.isSafeInteger(id) && id !== me.userId).slice(0, 50);
  if (wanted.length === 0) return { code: "none", sent: 0 };
  const now = new Date();
  await repo.expireGroupInvites(now);
  const [invited, people] = await Promise.all([repo.invitedTo(chat.chatId, now), repo.usersByIds(wanted)]);
  let sent = 0;
  for (const friend of people.values()) {
    if (friend.isWeb) continue;
    const [rel, member] = await Promise.all([relationOf(me.userId, friend.userId), repo.isMember(chat.chatId, friend.userId)]);
    const verdict = inviteVerdict({ rel, inviterIsMember: true, inviteeIsMember: member, pending: invited.has(friend.userId) });
    if (!verdict.ok) continue;
    if (await overLimit("inv", me.userId, FRIEND_LIMITS.invitesPerDay, DAY)) {
      return { code: sent ? "sent" : "throttled", sent };
    }
    const invite = await repo.createGroupInvite({
      chatId: chat.chatId,
      from: me.userId,
      to: friend.userId,
      kind: "invite",
      expiresAt: inviteExpiry(now),
    });
    if (!invite) continue;
    invited.add(friend.userId);
    sent += 1;
    await notifyGroupInvite(friend, me, chat, invite.id);
  }
  return { code: sent ? "sent" : "none", sent };
}

export type InviteAnswer = {
  code: "joined" | "declined" | "approved" | InviteAnswerRefusal;
  chat?: Chat;
  other?: User;
};

/**
 * Ответ на приглашение (я вступаю) или на просьбу (впускаю друга). Всё
 * проверяется заново: живое ли, моё ли, в группе ли ещё хозяин, нет ли
 * блокировки. Вступление и ответ — одной транзакцией.
 */
export async function answerGroupInvite(me: User, inviteId: number, accept: boolean): Promise<InviteAnswer> {
  const invite = await repo.getGroupInvite(inviteId);
  const chat = invite ? await repo.getChat(invite.chatId) : null;
  if (!invite || !chat) return { code: "gone" };
  const ask = invite.kind === "ask";
  // invite: хозяин — пригласивший, вступаю я; ask: хозяин — я, вступает просящий.
  const hostId = ask ? me.userId : invite.fromUser;
  const joinerId = ask ? invite.fromUser : me.userId;
  const [hostIsMember, joinerIsMember, blocks] = await Promise.all([
    repo.isMember(chat.chatId, hostId),
    repo.isMember(chat.chatId, joinerId),
    repo.blockState(me.userId, invite.fromUser),
  ]);
  const verdict = inviteAnswerVerdict({
    invite,
    me: me.userId,
    accept,
    now: new Date(),
    hostIsMember,
    joinerIsMember,
    blocked: blocks.byMe || blocks.byThem,
  });
  if (!verdict.ok) {
    // Мёртвое приглашение больше не показываем — гасим его.
    if (verdict.reason !== "not_yours" && verdict.reason !== "gone") {
      await repo.decideGroupInvite(inviteId, me.userId, "declined");
    }
    return { code: verdict.reason, chat };
  }
  if (!accept) {
    const declined = await repo.decideGroupInvite(inviteId, me.userId, "declined");
    return { code: declined ? "declined" : "gone", chat };
  }
  const joined = await repo.transaction(async (tx) => {
    const decided = await repo.decideGroupInvite(inviteId, me.userId, "accepted", tx);
    if (!decided) return false;
    await repo.addMembership(chat.chatId, joinerId, tx);
    return true;
  });
  if (!joined) return { code: "gone", chat };
  const other = await repo.getUser(invite.fromUser);
  if (other) await notifyJoinedByFriend(other, me, chat, ask ? "fr_ask_approved" : "fr_invite_accepted");
  if (chat.slug === null) await repo.ensureSlug(chat);
  return { code: ask ? "approved" : "joined", chat: (await repo.getChat(chat.chatId)) ?? chat, other: other ?? undefined };
}

export type AskOutcome = "asked" | "throttled" | "gone" | AskRefusal;

/** Попроситься в группу друга: просьба уходит ему, впускает он. */
export async function askToJoin(me: User, friendId: number, chatId: number): Promise<AskOutcome> {
  const [friend, chat] = await Promise.all([repo.getUser(friendId), repo.getChat(chatId)]);
  if (!friend || !chat) return "gone";
  const now = new Date();
  await repo.expireGroupInvites(now);
  const [rel, groups, askerIsMember, asked] = await Promise.all([
    relationOf(me.userId, friendId),
    repo.groupsOfUser(friendId),
    repo.isMember(chatId, me.userId),
    repo.pendingAsksFrom(me.userId, now),
  ]);
  const group = groups.find((entry) => entry.chatId === chatId);
  const verdict = askVerdict({
    rel,
    friendIsMember: Boolean(group),
    groupVisible: Boolean(group) && !group!.hidden && canSeeGroups(rel, friend),
    askerIsMember,
    pending: asked.has(chatId),
  });
  if (!verdict.ok) return verdict.reason;
  if (await overLimit("ask", me.userId, FRIEND_LIMITS.asksPerDay, DAY)) return "throttled";
  const ask = await repo.createGroupInvite({ chatId, from: me.userId, to: friendId, kind: "ask", expiresAt: inviteExpiry(now) });
  if (!ask) return "pending";
  await notifyGroupAsk(friend, me, chat, ask.id);
  return "asked";
}

export type { InviteRefusal };

// --------------------------------------------------------------------------
// Общее свободное время
// --------------------------------------------------------------------------

export type FreeTogether =
  | { status: "hidden" }
  | { status: "missing"; me: boolean; friend: boolean }
  /** Все дни недели по порядку, и без общих окон: полоска дня показывает и пустые. */
  | { status: "ok"; tz: string; days: { day: DateStr; windows: Interval[] }[] };

/**
 * Сколько вперёд и какие окна предлагаем двоим: две недели плана встречи
 * (core/pairPlan), 8–22, от получаса — короче встречу не назначить.
 */
export const TOGETHER = {
  daysAhead: PAIR_PLAN.daysAhead,
  dayStart: PAIR_PLAN.dayStart,
  dayEnd: PAIR_PLAN.dayEnd,
  minSlot: Math.min(...PAIR_PLAN.durations),
};

/**
 * Когда оба свободны на две недели вперёд — то же ядро, что у групп, только
 * на двоих и в поясе по умолчанию (Asia/Almaty). Только для друзей и если оба
 * не против (friends_see_free). Занятость друга наружу не уходит — только
 * общие окна.
 */
export async function freeTogether(me: User, friend: User, now = new Date(), rel?: Relation): Promise<FreeTogether> {
  const relation = rel ?? (await relationOf(me.userId, friend.userId));
  if (!canSeeFreeTime(relation, me, friend)) return { status: "hidden" };
  const people = await repo.buildPersonSchedules([me, friend]);
  const has = (id: number) => people.some((person) => person.userId === id && person.hasData);
  if (!has(me.userId) || !has(friend.userId)) {
    return { status: "missing", me: !has(me.userId), friend: !has(friend.userId) };
  }
  const tz = defaultTz();
  const today = todayIn(tz, now);
  const nowMin = utcToZonedWall(now, tz).minutes;
  const result = computeAvailability(people, today, TOGETHER);
  return {
    status: "ok",
    tz,
    days: result.days.map(({ day, windows }) => ({
      day,
      // Сегодняшние окна — не раньше «сейчас»: встречу в прошлом не назначить.
      windows: windows
        .map(({ interval }): Interval => (day === today ? [Math.max(interval[0], Math.ceil(nowMin / 10) * 10), interval[1]] : interval))
        .filter(([start, end]) => end - start >= TOGETHER.minSlot),
    })),
  };
}
