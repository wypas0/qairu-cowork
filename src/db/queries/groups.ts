/** Пользователи, группы и участники. */

import "server-only";

import { and, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import { type Chat, chats, memberships, ROLE_ADMIN, ROLE_MEMBER, type User, users } from "../schema";
import { type Exec, ex } from "./base";

// --------------------------------------------------------------------------
// Пользователи и чаты
// --------------------------------------------------------------------------

/** Создать или обновить пользователя. Username обновляем всегда — он меняется. */
export async function upsertUser(
  args: { userId: number; username?: string | null; fullName?: string; lang?: string | null },
  exec?: Exec,
): Promise<User> {
  const set: Record<string, unknown> = { username: args.username ?? null };
  if (args.fullName) set.fullName = args.fullName;
  if (args.lang) set.lang = args.lang;

  const [row] = await ex(exec)
    .insert(users)
    .values({
      userId: args.userId,
      username: args.username ?? null,
      fullName: args.fullName ?? "",
      lang: args.lang ?? "ru",
    })
    .onConflictDoUpdate({ target: users.userId, set })
    .returning();
  return row;
}

export async function getUser(userId: number, exec?: Exec): Promise<User | null> {
  const [row] = await ex(exec).select().from(users).where(eq(users.userId, userId)).limit(1);
  return row ?? null;
}

export async function setUserLang(userId: number, lang: string, exec?: Exec): Promise<void> {
  await ex(exec).update(users).set({ lang }).where(eq(users.userId, userId));
}

export async function renameUser(userId: number, fullName: string, exec?: Exec): Promise<void> {
  const clean = fullName.trim();
  if (!clean) return;
  await ex(exec)
    .update(users)
    .set({ fullName: clean.slice(0, 120) })
    .where(eq(users.userId, userId));
}

/** Настоящее имя из профиля; пустая строка убирает его. Имя из Telegram не трогается. */
export async function setRealName(userId: number, value: string, exec?: Exec): Promise<string | null> {
  const clean = normalizeRealName(value) || null;
  await ex(exec).update(users).set({ realName: clean }).where(eq(users.userId, userId));
  return clean;
}

export const REAL_NAME_MAX = 60;

/** Пробелы схлопнуты, управляющие символы убраны, длина ограничена. Пустая строка — имени нет. */
export function normalizeRealName(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, REAL_NAME_MAX)
    .trim();
}

export async function upsertChat(chatId: number, title: string, exec?: Exec): Promise<Chat> {
  const set: Record<string, unknown> = {};
  if (title) set.title = title.slice(0, 256);

  const [row] = await ex(exec)
    .insert(chats)
    .values({ chatId, title: title.slice(0, 256) })
    .onConflictDoUpdate({
      target: chats.chatId,
      // Пустой set в ON CONFLICT недопустим — тогда просто переписываем chat_id собой.
      set: Object.keys(set).length ? set : { chatId: sql`${chats.chatId}` },
    })
    .returning();
  return row;
}

export async function getChat(chatId: number, exec?: Exec): Promise<Chat | null> {
  const [row] = await ex(exec).select().from(chats).where(eq(chats.chatId, chatId)).limit(1);
  return row ?? null;
}

export async function getChatBySlug(slug: string, exec?: Exec): Promise<Chat | null> {
  const [row] = await ex(exec).select().from(chats).where(eq(chats.slug, slug)).limit(1);
  return row ?? null;
}

export async function updateChat(
  chatId: number,
  patch: Partial<typeof chats.$inferInsert>,
  exec?: Exec,
): Promise<void> {
  await ex(exec).update(chats).set(patch).where(eq(chats.chatId, chatId));
}

/** true, если участник добавлен впервые. Роль уже состоящего участника не меняется. */
export async function addMembership(
  chatId: number,
  userId: number,
  exec?: Exec,
  role: string = ROLE_MEMBER,
): Promise<boolean> {
  const inserted = await ex(exec)
    .insert(memberships)
    .values({ chatId, userId, role })
    .onConflictDoNothing()
    .returning({ chatId: memberships.chatId });
  return inserted.length > 0;
}

export type RosterEntry = { user: User; role: string; joinedAt: Date };

/** Участники вместе с ролью: администраторы первыми, дальше по имени. */
export async function chatRoster(chatId: number, exec?: Exec): Promise<RosterEntry[]> {
  const rows = await ex(exec)
    .select({ user: users, role: memberships.role, joinedAt: memberships.joinedAt })
    .from(users)
    .innerJoin(memberships, eq(memberships.userId, users.userId))
    .where(eq(memberships.chatId, chatId))
    .orderBy(users.fullName);
  return rows.sort((a, b) => Number(b.role === ROLE_ADMIN) - Number(a.role === ROLE_ADMIN));
}

export async function memberRole(
  chatId: number,
  userId: number,
  exec?: Exec,
): Promise<string | null> {
  const [row] = await ex(exec)
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.chatId, chatId), eq(memberships.userId, userId)))
    .limit(1);
  return row?.role ?? null;
}

/** Сменить роль. false — человек не состоит в группе. */
export async function setMemberRole(
  chatId: number,
  userId: number,
  role: string,
  exec?: Exec,
): Promise<boolean> {
  const updated = await ex(exec)
    .update(memberships)
    .set({ role: role === ROLE_ADMIN ? ROLE_ADMIN : ROLE_MEMBER })
    .where(and(eq(memberships.chatId, chatId), eq(memberships.userId, userId)))
    .returning({ userId: memberships.userId });
  return updated.length > 0;
}

export async function adminIds(chatId: number, exec?: Exec): Promise<number[]> {
  const rows = await ex(exec)
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.chatId, chatId), eq(memberships.role, ROLE_ADMIN)));
  return rows.map((row) => row.userId);
}

export async function removeMembership(
  chatId: number,
  userId: number,
  exec?: Exec,
): Promise<void> {
  await ex(exec)
    .delete(memberships)
    .where(and(eq(memberships.chatId, chatId), eq(memberships.userId, userId)));
}

export async function isMember(chatId: number, userId: number, exec?: Exec): Promise<boolean> {
  const [row] = await ex(exec)
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.chatId, chatId), eq(memberships.userId, userId)))
    .limit(1);
  return Boolean(row);
}

export async function chatMembers(chatId: number, exec?: Exec): Promise<User[]> {
  return ex(exec)
    .select(getTableColumns(users))
    .from(users)
    .innerJoin(memberships, eq(memberships.userId, users.userId))
    .where(eq(memberships.chatId, chatId))
    .orderBy(users.fullName);
}

export async function userChats(userId: number, exec?: Exec): Promise<Chat[]> {
  return ex(exec)
    .select({
      chatId: chats.chatId,
      slug: chats.slug,
      origin: chats.origin,
      title: chats.title,
      lang: chats.lang,
      tz: chats.tz,
      dayStartMin: chats.dayStartMin,
      dayEndMin: chats.dayEndMin,
      minSlotMin: chats.minSlotMin,
      travelBufferMin: chats.travelBufferMin,
      semesterStart: chats.semesterStart,
      reminderMin: chats.reminderMin,
      createdBy: chats.createdBy,
      createdAt: chats.createdAt,
    })
    .from(chats)
    .innerJoin(memberships, eq(memberships.chatId, chats.chatId))
    .where(eq(memberships.userId, userId));
}

export async function findUserByUsername(username: string, exec?: Exec): Promise<User | null> {
  const clean = username.replace(/^@+/, "").toLowerCase();
  if (!clean) return null;
  const [row] = await ex(exec)
    .select()
    .from(users)
    .where(sql`lower(${users.username}) = ${clean}`)
    .limit(1);
  return row ?? null;
}

export async function usersByIds(ids: number[], exec?: Exec): Promise<Map<number, User>> {
  if (ids.length === 0) return new Map();
  const rows = await ex(exec).select().from(users).where(inArray(users.userId, ids));
  return new Map(rows.map((row) => [row.userId, row]));
}
