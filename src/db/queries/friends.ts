/**
 * Друзья: дружба, заявки, блокировки, личные ссылки, приглашения в группы.
 *
 * Здесь только чтение и запись. Можно ли — решают правила core/friends, а
 * собирает всё вместе lib/friends: сайт и бот ходят только через него.
 */

import "server-only";

import { and, asc, desc, eq, gt, inArray, isNotNull, or, sql } from "drizzle-orm";

import { pairOf } from "@/core/friends";
import {
  type Chat,
  chats,
  type FriendRequest,
  friendLinks,
  friendRequests,
  friendships,
  type GroupInvite,
  groupInvites,
  meetings,
  memberships,
  type User,
  userBlocks,
  users,
} from "../schema";
import { type Exec, ex } from "./base";

/** Группа в разделе друзей: без лишнего; slug — только тем, кто в ней состоит (см. lib/friends). */
export type FriendGroup = Pick<Chat, "chatId" | "slug" | "title"> & { members: number; hidden: boolean };

// --------------------------------------------------------------------------
// Дружба
// --------------------------------------------------------------------------

export async function areFriends(a: number, b: number, exec?: Exec): Promise<boolean> {
  const [low, high] = pairOf(a, b);
  const [row] = await ex(exec)
    .select({ a: friendships.userA })
    .from(friendships)
    .where(and(eq(friendships.userA, low), eq(friendships.userB, high)))
    .limit(1);
  return Boolean(row);
}

/** id друзей человека. */
export async function friendIdsOf(userId: number, exec?: Exec): Promise<number[]> {
  const rows = await ex(exec)
    .select({ a: friendships.userA, b: friendships.userB })
    .from(friendships)
    .where(or(eq(friendships.userA, userId), eq(friendships.userB, userId)));
  return rows.map((row) => (row.a === userId ? row.b : row.a));
}

/** Друзья с датой дружбы, по имени. */
export async function friendsOf(userId: number, exec?: Exec): Promise<{ user: User; since: Date }[]> {
  const other = sql<number>`case when ${friendships.userA} = ${userId} then ${friendships.userB} else ${friendships.userA} end`;
  const rows = await ex(exec)
    .select({ user: users, since: friendships.createdAt })
    .from(friendships)
    .innerJoin(users, eq(users.userId, other))
    .where(or(eq(friendships.userA, userId), eq(friendships.userB, userId)))
    .orderBy(asc(sql`coalesce(${users.realName}, ${users.fullName})`));
  return rows;
}

export async function friendCount(userId: number, exec?: Exec): Promise<number> {
  const [row] = await ex(exec)
    .select({ n: sql<number>`count(*)::int` })
    .from(friendships)
    .where(or(eq(friendships.userA, userId), eq(friendships.userB, userId)));
  return row?.n ?? 0;
}

/** true, если дружба появилась сейчас (а не была раньше). */
export async function addFriendship(a: number, b: number, exec?: Exec): Promise<boolean> {
  const [low, high] = pairOf(a, b);
  const inserted = await ex(exec)
    .insert(friendships)
    .values({ userA: low, userB: high })
    .onConflictDoNothing()
    .returning({ a: friendships.userA });
  return inserted.length > 0;
}

export async function removeFriendship(a: number, b: number, exec?: Exec): Promise<boolean> {
  const [low, high] = pairOf(a, b);
  const deleted = await ex(exec)
    .delete(friendships)
    .where(and(eq(friendships.userA, low), eq(friendships.userB, high)))
    .returning({ a: friendships.userA });
  return deleted.length > 0;
}

// --------------------------------------------------------------------------
// Блокировки
// --------------------------------------------------------------------------

/** Кто кого заблокировал в паре «я — он». */
export async function blockState(me: number, other: number, exec?: Exec): Promise<{ byMe: boolean; byThem: boolean }> {
  const rows = await ex(exec)
    .select({ blocker: userBlocks.blocker })
    .from(userBlocks)
    .where(
      or(
        and(eq(userBlocks.blocker, me), eq(userBlocks.blocked, other)),
        and(eq(userBlocks.blocker, other), eq(userBlocks.blocked, me)),
      ),
    );
  return { byMe: rows.some((row) => row.blocker === me), byThem: rows.some((row) => row.blocker === other) };
}

/** Кого человек заблокировал — по времени блокировки, свежие первыми. */
export async function blockedUsersBy(userId: number, exec?: Exec): Promise<User[]> {
  const rows = await ex(exec)
    .select({ user: users })
    .from(userBlocks)
    .innerJoin(users, eq(users.userId, userBlocks.blocked))
    .where(eq(userBlocks.blocker, userId))
    .orderBy(desc(userBlocks.createdAt));
  return rows.map((row) => row.user);
}

export async function blockedIdsBy(userId: number, exec?: Exec): Promise<Set<number>> {
  const rows = await ex(exec)
    .select({ id: userBlocks.blocked })
    .from(userBlocks)
    .where(eq(userBlocks.blocker, userId));
  return new Set(rows.map((row) => row.id));
}

export async function addBlock(blocker: number, blocked: number, exec?: Exec): Promise<void> {
  await ex(exec).insert(userBlocks).values({ blocker, blocked }).onConflictDoNothing();
}

export async function removeBlock(blocker: number, blocked: number, exec?: Exec): Promise<boolean> {
  const deleted = await ex(exec)
    .delete(userBlocks)
    .where(and(eq(userBlocks.blocker, blocker), eq(userBlocks.blocked, blocked)))
    .returning({ id: userBlocks.blocked });
  return deleted.length > 0;
}

// --------------------------------------------------------------------------
// Заявки
// --------------------------------------------------------------------------

/** Живая заявка между двумя людьми в любую сторону. */
export async function pendingRequestBetween(a: number, b: number, exec?: Exec): Promise<FriendRequest | null> {
  const [row] = await ex(exec)
    .select()
    .from(friendRequests)
    .where(
      and(
        eq(friendRequests.status, "pending"),
        or(
          and(eq(friendRequests.fromUser, a), eq(friendRequests.toUser, b)),
          and(eq(friendRequests.fromUser, b), eq(friendRequests.toUser, a)),
        ),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Когда `to` последний раз отклонил заявку от `from`. */
export async function lastDeclined(from: number, to: number, exec?: Exec): Promise<Date | null> {
  const [row] = await ex(exec)
    .select({ at: friendRequests.decidedAt })
    .from(friendRequests)
    .where(and(eq(friendRequests.fromUser, from), eq(friendRequests.toUser, to), eq(friendRequests.status, "declined")))
    .orderBy(desc(friendRequests.decidedAt))
    .limit(1);
  return row?.at ?? null;
}

export async function pendingOutCount(userId: number, exec?: Exec): Promise<number> {
  const [row] = await ex(exec)
    .select({ n: sql<number>`count(*)::int` })
    .from(friendRequests)
    .where(and(eq(friendRequests.fromUser, userId), eq(friendRequests.status, "pending")));
  return row?.n ?? 0;
}

/**
 * Записать заявку. null — живая заявка между этими людьми уже есть
 * (уникальный индекс по паре): одновременные двойные нажатия не плодят строк.
 */
export async function createFriendRequest(
  args: { from: number; to: number; via: string; status?: "pending" | "accepted"; at?: Date },
  exec?: Exec,
): Promise<FriendRequest | null> {
  const accepted = args.status === "accepted";
  const [row] = await ex(exec)
    .insert(friendRequests)
    .values({
      fromUser: args.from,
      toUser: args.to,
      via: args.via.slice(0, 8),
      status: accepted ? "accepted" : "pending",
      decidedAt: accepted ? (args.at ?? new Date()) : null,
    })
    .onConflictDoNothing()
    .returning();
  return row ?? null;
}

export async function getFriendRequest(id: number, exec?: Exec): Promise<FriendRequest | null> {
  const [row] = await ex(exec).select().from(friendRequests).where(eq(friendRequests.id, id)).limit(1);
  return row ?? null;
}

/**
 * Ответ адресата. Условие «адресат — я и заявка ещё жива» стоит в самом
 * UPDATE: чужую заявку не принять, подставив её номер, а дважды — не ответить.
 */
export async function decideFriendRequest(
  id: number,
  toUser: number,
  status: "accepted" | "declined",
  exec?: Exec,
): Promise<FriendRequest | null> {
  const [row] = await ex(exec)
    .update(friendRequests)
    .set({ status, decidedAt: new Date() })
    .where(and(eq(friendRequests.id, id), eq(friendRequests.toUser, toUser), eq(friendRequests.status, "pending")))
    .returning();
  return row ?? null;
}

/**
 * Вернуть только что отклонённую заявку («Вернуть» в тосте): только свою
 * (адресат — я) и только отклонённую после `since`. null — поздно или уже
 * есть другая живая заявка между этими людьми (уникальный индекс).
 */
export async function restoreFriendRequest(id: number, toUser: number, since: Date, exec?: Exec): Promise<FriendRequest | null> {
  try {
    const [row] = await ex(exec)
      .update(friendRequests)
      .set({ status: "pending", decidedAt: null })
      .where(
        and(
          eq(friendRequests.id, id),
          eq(friendRequests.toUser, toUser),
          eq(friendRequests.status, "declined"),
          gt(friendRequests.decidedAt, since),
        ),
      )
      .returning();
    return row ?? null;
  } catch (error) {
    if (uniqueViolation(error)) return null;
    throw error;
  }
}

/** 23505 — нарушена уникальность (драйвер кладёт код прямо в ошибку или в cause). */
function uniqueViolation(error: unknown): boolean {
  const failure = error as { code?: string; cause?: { code?: string } };
  return failure.code === "23505" || failure.cause?.code === "23505";
}

/** Отозвать свою заявку. */
export async function cancelFriendRequest(id: number, fromUser: number, exec?: Exec): Promise<FriendRequest | null> {
  const [row] = await ex(exec)
    .update(friendRequests)
    .set({ status: "cancelled", decidedAt: new Date() })
    .where(and(eq(friendRequests.id, id), eq(friendRequests.fromUser, fromUser), eq(friendRequests.status, "pending")))
    .returning();
  return row ?? null;
}

/** Погасить живые заявки между двумя людьми (блокировка, удаление из друзей). */
export async function cancelRequestsBetween(a: number, b: number, exec?: Exec): Promise<void> {
  await ex(exec)
    .update(friendRequests)
    .set({ status: "cancelled", decidedAt: new Date() })
    .where(
      and(
        eq(friendRequests.status, "pending"),
        or(
          and(eq(friendRequests.fromUser, a), eq(friendRequests.toUser, b)),
          and(eq(friendRequests.fromUser, b), eq(friendRequests.toUser, a)),
        ),
      ),
    );
}

/** Не заблокирован ли отправитель адресатом — подзапрос для входящих. */
const notBlockedBy = (recipient: number, sender: typeof friendRequests.fromUser | typeof groupInvites.fromUser) =>
  sql`not exists (select 1 from ${userBlocks} where ${userBlocks.blocker} = ${recipient} and ${userBlocks.blocked} = ${sender})`;

/** Входящие заявки. Заявки от тех, кого я заблокировал, не показываются вовсе. */
export async function incomingRequests(userId: number, exec?: Exec): Promise<{ request: FriendRequest; from: User }[]> {
  return ex(exec)
    .select({ request: friendRequests, from: users })
    .from(friendRequests)
    .innerJoin(users, eq(users.userId, friendRequests.fromUser))
    .where(
      and(
        eq(friendRequests.toUser, userId),
        eq(friendRequests.status, "pending"),
        notBlockedBy(userId, friendRequests.fromUser),
      ),
    )
    .orderBy(desc(friendRequests.createdAt));
}

export async function outgoingRequests(userId: number, exec?: Exec): Promise<{ request: FriendRequest; to: User }[]> {
  return ex(exec)
    .select({ request: friendRequests, to: users })
    .from(friendRequests)
    .innerJoin(users, eq(users.userId, friendRequests.toUser))
    .where(and(eq(friendRequests.fromUser, userId), eq(friendRequests.status, "pending")))
    .orderBy(desc(friendRequests.createdAt));
}

/** Живые заявки человека с этими людьми: кому он отправил и от кого ждёт ответа. */
export async function pendingWith(
  userId: number,
  others: number[],
  exec?: Exec,
): Promise<{ out: Set<number>; in: Set<number> }> {
  if (others.length === 0) return { out: new Set(), in: new Set() };
  const rows = await ex(exec)
    .select({ from: friendRequests.fromUser, to: friendRequests.toUser })
    .from(friendRequests)
    .where(
      and(
        eq(friendRequests.status, "pending"),
        or(
          and(eq(friendRequests.fromUser, userId), inArray(friendRequests.toUser, others)),
          and(eq(friendRequests.toUser, userId), inArray(friendRequests.fromUser, others)),
        ),
      ),
    );
  return {
    out: new Set(rows.filter((row) => row.from === userId).map((row) => row.to)),
    in: new Set(rows.filter((row) => row.to === userId).map((row) => row.from)),
  };
}

// --------------------------------------------------------------------------
// Поиск и личная ссылка
// --------------------------------------------------------------------------

/**
 * Человек по точному нику — только тот, кто разрешил себя находить и вошёл
 * через Telegram. Ни подстрок, ни похожих ников: перебором список людей не
 * вытянуть.
 */
export async function findableByUsername(username: string, exec?: Exec): Promise<User | null> {
  const [row] = await ex(exec)
    .select()
    .from(users)
    .where(
      and(
        sql`lower(${users.username}) = ${username.toLowerCase()}`,
        eq(users.findable, true),
        eq(users.isWeb, false),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Есть ли у двоих общая группа — тогда «В друзья» можно нажать прямо в «Участниках». */
export async function shareGroup(a: number, b: number, exec?: Exec): Promise<boolean> {
  const mine = ex(exec).select({ chatId: memberships.chatId }).from(memberships).where(eq(memberships.userId, a));
  const [row] = await ex(exec)
    .select({ chatId: memberships.chatId })
    .from(memberships)
    .where(and(eq(memberships.userId, b), inArray(memberships.chatId, mine)))
    .limit(1);
  return Boolean(row);
}

/** Сколько групп у человека общих с каждым из этих людей. */
export async function sharedGroupCounts(userId: number, others: number[], exec?: Exec): Promise<Map<number, number>> {
  if (others.length === 0) return new Map();
  const mine = ex(exec).select({ chatId: memberships.chatId }).from(memberships).where(eq(memberships.userId, userId));
  const rows = await ex(exec)
    .select({ userId: memberships.userId, n: sql<number>`count(*)::int` })
    .from(memberships)
    .where(and(inArray(memberships.userId, others), inArray(memberships.chatId, mine)))
    .groupBy(memberships.userId);
  return new Map(rows.map((row) => [row.userId, row.n]));
}

/** Названия общих групп с каждым из этих людей — «общая группа: ИС-21» у заявки и в поиске. */
export async function sharedGroupTitles(userId: number, others: number[], exec?: Exec): Promise<Map<number, string[]>> {
  const result = new Map<number, string[]>();
  if (others.length === 0) return result;
  const mine = ex(exec).select({ chatId: memberships.chatId }).from(memberships).where(eq(memberships.userId, userId));
  const rows = await ex(exec)
    .select({ userId: memberships.userId, title: chats.title })
    .from(memberships)
    .innerJoin(chats, eq(chats.chatId, memberships.chatId))
    .where(and(inArray(memberships.userId, others), inArray(memberships.chatId, mine)))
    .orderBy(asc(chats.title));
  for (const row of rows) result.set(row.userId, [...(result.get(row.userId) ?? []), row.title]);
  return result;
}

/** Общие группы двоих — оба в них состоят, поэтому и адрес знают оба. */
export async function sharedGroups(a: number, b: number, exec?: Exec): Promise<Pick<Chat, "chatId" | "slug" | "title">[]> {
  const theirs = ex(exec).select({ chatId: memberships.chatId }).from(memberships).where(eq(memberships.userId, b));
  return ex(exec)
    .select({ chatId: chats.chatId, slug: chats.slug, title: chats.title })
    .from(memberships)
    .innerJoin(chats, eq(chats.chatId, memberships.chatId))
    .where(and(eq(memberships.userId, a), inArray(memberships.chatId, theirs)))
    .orderBy(asc(chats.title));
}

export async function friendLinkOf(userId: number, exec?: Exec): Promise<string | null> {
  const [row] = await ex(exec).select({ code: friendLinks.code }).from(friendLinks).where(eq(friendLinks.userId, userId)).limit(1);
  return row?.code ?? null;
}

/** Поставить новый код. false — такой код уже занят (вызывающий берёт другой). */
export async function setFriendLink(userId: number, code: string, exec?: Exec): Promise<boolean> {
  try {
    await ex(exec)
      .insert(friendLinks)
      .values({ userId, code })
      .onConflictDoUpdate({ target: friendLinks.userId, set: { code, createdAt: new Date() } });
    return true;
  } catch (error) {
    // Код совпал с чужим (уникальность friend_links.code).
    if (uniqueViolation(error)) return false;
    throw error;
  }
}

/** Владелец личной ссылки — только Telegram-аккаунт. */
export async function userByFriendCode(code: string, exec?: Exec): Promise<User | null> {
  const [row] = await ex(exec)
    .select({ user: users })
    .from(friendLinks)
    .innerJoin(users, eq(users.userId, friendLinks.userId))
    .where(and(eq(friendLinks.code, code), eq(users.isWeb, false)))
    .limit(1);
  return row?.user ?? null;
}

// --------------------------------------------------------------------------
// Настройки
// --------------------------------------------------------------------------

export async function setFriendSettings(
  userId: number,
  patch: { friendsSeeGroups?: boolean; friendsSeeFree?: boolean; findable?: boolean },
  exec?: Exec,
): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  await ex(exec).update(users).set(patch).where(eq(users.userId, userId));
}

/** Скрыть свою группу от друзей или вернуть. false — человек не в этой группе. */
export async function setGroupHidden(chatId: number, userId: number, hidden: boolean, exec?: Exec): Promise<boolean> {
  const updated = await ex(exec)
    .update(memberships)
    .set({ hiddenFromFriends: hidden })
    .where(and(eq(memberships.chatId, chatId), eq(memberships.userId, userId)))
    .returning({ chatId: memberships.chatId });
  return updated.length > 0;
}

/** Группы человека с числом участников и пометкой «скрыта от друзей», по названию. */
export async function groupsOfUser(userId: number, exec?: Exec): Promise<FriendGroup[]> {
  const members = sql<number>`(select count(*)::int from ${memberships} m2 where m2.chat_id = ${chats.chatId})`;
  return ex(exec)
    .select({
      chatId: chats.chatId,
      slug: chats.slug,
      title: chats.title,
      members,
      hidden: memberships.hiddenFromFriends,
    })
    .from(memberships)
    .innerJoin(chats, eq(chats.chatId, memberships.chatId))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(chats.title));
}

/** id групп, в которых состоит человек. */
export async function chatIdsOf(userId: number, exec?: Exec): Promise<Set<number>> {
  const rows = await ex(exec).select({ chatId: memberships.chatId }).from(memberships).where(eq(memberships.userId, userId));
  return new Set(rows.map((row) => row.chatId));
}

// --------------------------------------------------------------------------
// Приглашения в группы и просьбы вступить
// --------------------------------------------------------------------------

/** null — такое же приглашение уже ждёт ответа (уникальный индекс). */
export async function createGroupInvite(
  args: { chatId: number; from: number; to: number; kind: "invite" | "ask"; expiresAt: Date },
  exec?: Exec,
): Promise<GroupInvite | null> {
  const [row] = await ex(exec)
    .insert(groupInvites)
    .values({ chatId: args.chatId, fromUser: args.from, toUser: args.to, kind: args.kind, expiresAt: args.expiresAt })
    .onConflictDoNothing()
    .returning();
  return row ?? null;
}

export async function getGroupInvite(id: number, exec?: Exec): Promise<GroupInvite | null> {
  const [row] = await ex(exec).select().from(groupInvites).where(eq(groupInvites.id, id)).limit(1);
  return row ?? null;
}

/**
 * Просроченные живые приглашения — в «cancelled»: они больше не держат
 * уникальный индекс и не мешают позвать человека заново.
 */
export async function expireGroupInvites(now: Date, exec?: Exec): Promise<void> {
  await ex(exec)
    .update(groupInvites)
    .set({ status: "cancelled", decidedAt: now })
    .where(and(eq(groupInvites.status, "pending"), sql`${groupInvites.expiresAt} <= ${now.toISOString()}::timestamptz`));
}

/** Кого уже позвали в группу и ещё ждут: человек → живое приглашение. */
export async function invitedTo(chatId: number, now: Date, exec?: Exec): Promise<Set<number>> {
  const rows = await ex(exec)
    .select({ to: groupInvites.toUser })
    .from(groupInvites)
    .where(
      and(
        eq(groupInvites.chatId, chatId),
        eq(groupInvites.kind, "invite"),
        eq(groupInvites.status, "pending"),
        gt(groupInvites.expiresAt, now),
      ),
    );
  return new Set(rows.map((row) => row.to));
}

/** Куда человек уже попросился и ждёт: id групп. */
export async function pendingAsksFrom(userId: number, now: Date, exec?: Exec): Promise<Set<number>> {
  const rows = await ex(exec)
    .select({ chatId: groupInvites.chatId })
    .from(groupInvites)
    .where(
      and(
        eq(groupInvites.fromUser, userId),
        eq(groupInvites.kind, "ask"),
        eq(groupInvites.status, "pending"),
        gt(groupInvites.expiresAt, now),
      ),
    );
  return new Set(rows.map((row) => row.chatId));
}

/** Ответ адресата: условие «адресат — я, живое» — в самом UPDATE. */
export async function decideGroupInvite(
  id: number,
  toUser: number,
  status: "accepted" | "declined",
  exec?: Exec,
): Promise<GroupInvite | null> {
  const [row] = await ex(exec)
    .update(groupInvites)
    .set({ status, decidedAt: new Date() })
    .where(and(eq(groupInvites.id, id), eq(groupInvites.toUser, toUser), eq(groupInvites.status, "pending")))
    .returning();
  return row ?? null;
}

/** Вернуть только что отклонённое приглашение или просьбу — как restoreFriendRequest, и пока не истёк срок. */
export async function restoreGroupInvite(
  id: number,
  toUser: number,
  since: Date,
  now: Date,
  exec?: Exec,
): Promise<GroupInvite | null> {
  try {
    const [row] = await ex(exec)
      .update(groupInvites)
      .set({ status: "pending", decidedAt: null })
      .where(
        and(
          eq(groupInvites.id, id),
          eq(groupInvites.toUser, toUser),
          eq(groupInvites.status, "declined"),
          gt(groupInvites.decidedAt, since),
          gt(groupInvites.expiresAt, now),
        ),
      )
      .returning();
    return row ?? null;
  } catch (error) {
    if (uniqueViolation(error)) return null;
    throw error;
  }
}

/** Погасить живые приглашения и просьбы между двумя людьми (блокировка, удаление из друзей). */
export async function cancelInvitesBetween(a: number, b: number, exec?: Exec): Promise<void> {
  await ex(exec)
    .update(groupInvites)
    .set({ status: "cancelled", decidedAt: new Date() })
    .where(
      and(
        eq(groupInvites.status, "pending"),
        or(
          and(eq(groupInvites.fromUser, a), eq(groupInvites.toUser, b)),
          and(eq(groupInvites.fromUser, b), eq(groupInvites.toUser, a)),
        ),
      ),
    );
}

export type InviteEntry = { invite: GroupInvite; from: User; chat: Pick<Chat, "chatId" | "slug" | "title"> };

/**
 * Входящие приглашения (kind = invite) или просьбы (kind = ask). Показываются
 * только живые: не просроченные, не от заблокированных, и пока «хозяин»
 * группы в ней — пригласивший (invite) или я сам (ask).
 */
export async function incomingInvites(
  userId: number,
  kind: "invite" | "ask",
  now: Date,
  exec?: Exec,
): Promise<InviteEntry[]> {
  const host = kind === "invite" ? groupInvites.fromUser : groupInvites.toUser;
  return ex(exec)
    .select({
      invite: groupInvites,
      from: users,
      chat: { chatId: chats.chatId, slug: chats.slug, title: chats.title },
    })
    .from(groupInvites)
    .innerJoin(users, eq(users.userId, groupInvites.fromUser))
    .innerJoin(chats, eq(chats.chatId, groupInvites.chatId))
    .where(
      and(
        eq(groupInvites.toUser, userId),
        eq(groupInvites.kind, kind),
        eq(groupInvites.status, "pending"),
        gt(groupInvites.expiresAt, now),
        notBlockedBy(userId, groupInvites.fromUser),
        sql`exists (select 1 from ${memberships} m3 where m3.chat_id = ${groupInvites.chatId} and m3.user_id = ${host})`,
      ),
    )
    .orderBy(desc(groupInvites.createdAt));
}

/**
 * Сколько ждёт человека в «Друзьях»: заявки, приглашения в группы, просьбы
 * вступить, встречи вдвоём без ответа — одним запросом (счётчик стоит на
 * каждой странице).
 */
export async function friendBadge(userId: number, now: Date, exec?: Exec): Promise<number> {
  const at = now.toISOString();
  // Те же условия, что у списков выше: от заблокированных и мёртвые — не в счёт.
  const [row] = await ex(exec)
    .select({
      n: sql<number>`(
        (select count(*)::int from friend_requests r
          where r.to_user = ${userId} and r.status = 'pending'
            and not exists (select 1 from user_blocks b where b.blocker = ${userId} and b.blocked = r.from_user))
        +
        (select count(*)::int from group_invites i
          where i.to_user = ${userId} and i.status = 'pending' and i.expires_at > ${at}::timestamptz
            and not exists (select 1 from user_blocks b where b.blocker = ${userId} and b.blocked = i.from_user)
            and exists (select 1 from memberships m
              where m.chat_id = i.chat_id and m.user_id = case when i.kind = 'invite' then i.from_user else i.to_user end))
        +
        -- Встречи вдвоём без моего ответа — те же условия, что у pendingPairInvites.
        (select count(*)::int from meetings mt
          where mt.with_user = ${userId} and mt.status = 'open'
            and ((mt.repeat_until is not null and mt.repeat_until >= ${at.slice(0, 10)}::date)
              or (mt.repeat_until is null and mt.when_start >= ${at}::timestamptz))
            and not exists (select 1 from meeting_responses r where r.meeting_id = mt.id and r.user_id = ${userId})
            and not exists (select 1 from user_blocks b where b.blocker = ${userId} and b.blocked = mt.initiator_id))
      )`,
    })
    .from(users)
    .where(eq(users.userId, userId));
  return Number(row?.n ?? 0);
}

// --------------------------------------------------------------------------
// Консоль владельца
// --------------------------------------------------------------------------

export type FriendStats = {
  requests: number;
  accepted: number;
  viaLink: number;
  invites: number;
  joined: number;
  asks: number;
  blocks: number;
  /** Встреч вдвоём назначено. */
  pairMeetings: number;
};

/** Что происходило с друзьями с момента `since`: только числа, без людей. */
export async function friendStats(since: Date, exec?: Exec): Promise<FriendStats> {
  const db = ex(exec);
  const [requests] = await db
    .select({
      requests: sql<number>`count(*) filter (where ${friendRequests.via} <> 'link')::int`,
      accepted: sql<number>`count(*) filter (where ${friendRequests.status} = 'accepted' and ${friendRequests.via} <> 'link')::int`,
      viaLink: sql<number>`count(*) filter (where ${friendRequests.via} = 'link')::int`,
    })
    .from(friendRequests)
    .where(gt(friendRequests.createdAt, since));
  const [invites] = await db
    .select({
      invites: sql<number>`count(*) filter (where ${groupInvites.kind} = 'invite')::int`,
      asks: sql<number>`count(*) filter (where ${groupInvites.kind} = 'ask')::int`,
      joined: sql<number>`count(*) filter (where ${groupInvites.status} = 'accepted')::int`,
    })
    .from(groupInvites)
    .where(gt(groupInvites.createdAt, since));
  const [blocks] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(userBlocks)
    .where(gt(userBlocks.createdAt, since));
  const [pairs] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(meetings)
    .where(and(isNotNull(meetings.withUser), gt(meetings.createdAt, since)));
  return {
    requests: requests?.requests ?? 0,
    accepted: requests?.accepted ?? 0,
    viaLink: requests?.viaLink ?? 0,
    invites: invites?.invites ?? 0,
    joined: invites?.joined ?? 0,
    asks: invites?.asks ?? 0,
    blocks: blocks?.n ?? 0,
    pairMeetings: pairs?.n ?? 0,
  };
}

/** Удалить погашенные заявки и приглашения старше `before` — ответы уже не нужны. */
export async function pruneFriendHistory(before: Date, exec?: Exec): Promise<void> {
  const at = before.toISOString();
  await ex(exec)
    .delete(groupInvites)
    .where(and(sql`${groupInvites.status} <> 'pending'`, sql`${groupInvites.decidedAt} < ${at}::timestamptz`));
  await ex(exec)
    .delete(friendRequests)
    .where(
      and(
        // Отказы старше месяца тоже: пауза после отказа — всего неделя.
        inArray(friendRequests.status, ["cancelled", "accepted", "declined"]),
        sql`${friendRequests.decidedAt} < ${at}::timestamptz`,
      ),
    );
}
