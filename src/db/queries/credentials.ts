/** Вход по логину и паролю. */

import "server-only";

import { and, eq, ne, sql } from "drizzle-orm";
import { credentials, type User, users, webSessions } from "../schema";
import { type Exec, ex } from "./base";
import { hashToken } from "./web";

// --------------------------------------------------------------------------
// Вход по логину и паролю
// --------------------------------------------------------------------------

export type CredentialsRow = typeof credentials.$inferSelect;

export async function getCredentials(userId: number, exec?: Exec): Promise<CredentialsRow | null> {
  const [row] = await ex(exec)
    .select()
    .from(credentials)
    .where(eq(credentials.userId, userId))
    .limit(1);
  return row ?? null;
}

/**
 * Занят ли логин кем-то, кроме `exceptUserId`.
 *
 * Логин не должен совпадать ни с чужим логином, ни с чужим подтверждённым
 * @username из Telegram — иначе ввод «amir» на странице входа стал бы
 * двусмысленным.
 */
export async function loginTaken(login: string, exceptUserId: number, exec?: Exec): Promise<boolean> {
  const db = ex(exec);
  const [byLogin] = await db
    .select({ userId: credentials.userId })
    .from(credentials)
    .where(eq(credentials.login, login))
    .limit(1);
  if (byLogin && byLogin.userId !== exceptUserId) return true;

  const [byUsername] = await db
    .select({ userId: users.userId })
    .from(users)
    .where(and(sql`lower(${users.username}) = ${login}`, eq(users.isWeb, false)))
    .limit(1);
  return Boolean(byUsername && byUsername.userId !== exceptUserId);
}

export async function setCredentials(
  args: { userId: number; login: string; passwordHash: string },
  exec?: Exec,
): Promise<void> {
  await ex(exec)
    .insert(credentials)
    .values({ userId: args.userId, login: args.login, passwordHash: args.passwordHash })
    .onConflictDoUpdate({
      target: credentials.userId,
      set: { login: args.login, passwordHash: args.passwordHash, updatedAt: new Date() },
    });
}

export async function deleteCredentials(userId: number, exec?: Exec): Promise<void> {
  await ex(exec).delete(credentials).where(eq(credentials.userId, userId));
}

/** Все сессии человека, кроме текущей: после смены пароля чужие входы обрываются. */
export async function deleteOtherWebSessions(
  userId: number,
  keepToken: string,
  exec?: Exec,
): Promise<void> {
  await ex(exec)
    .delete(webSessions)
    .where(and(eq(webSessions.userId, userId), ne(webSessions.tokenHash, hashToken(keepToken))));
}

/**
 * Найти учётные данные по тому, что человек ввёл в поле «логин».
 *
 * `@name` — только Telegram-ник подтверждённого аккаунта. Без @ сначала ищем
 * логин сайта, затем Telegram-ник: пересечься они не могут (см. loginTaken).
 */
export async function credentialsForLogin(
  input: string,
  exec?: Exec,
): Promise<{ user: User; credentials: CredentialsRow } | null> {
  const raw = input.trim();
  const clean = raw.replace(/^@+/, "").toLowerCase();
  if (!clean) return null;
  const db = ex(exec);

  if (!raw.startsWith("@")) {
    const [row] = await db
      .select({ user: users, credentials })
      .from(credentials)
      .innerJoin(users, eq(users.userId, credentials.userId))
      .where(eq(credentials.login, clean))
      .limit(1);
    if (row) return row;
  }

  const [row] = await db
    .select({ user: users, credentials })
    .from(credentials)
    .innerJoin(users, eq(users.userId, credentials.userId))
    .where(and(sql`lower(${users.username}) = ${clean}`, eq(users.isWeb, false)))
    .limit(1);
  return row ?? null;
}
