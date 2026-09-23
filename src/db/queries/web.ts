/** Веб-версия: коды групп, синтетические пользователи, сессии-ссылки. */

import "server-only";

import crypto from "node:crypto";
import { CODE_ALPHABET } from "@/lib/invite";
import { eq } from "drizzle-orm";
import { type Chat, chats, type User, users, webSessions } from "../schema";
import { type Exec, ex } from "./base";
import { getUser } from "./groups";

// --------------------------------------------------------------------------
// Веб-версия: слаги групп, синтетические пользователи, сессии-ссылки
// --------------------------------------------------------------------------

// Алфавит кода группы: без символов, которые путают на слух и глазами
// (см. src/lib/invite.ts). Старые слаги из полного алфавита продолжают работать.
const SLUG_ALPHABET = CODE_ALPHABET;
// Синтетические id для сущностей, созданных на сайте. Telegram выдаёт
// положительные id пользователям и id вида -100… чатам, поэтому диапазон
// ниже -10^15 гарантированно свободен.
const SYNTHETIC_BASE = -(10 ** 15);

export function newSlug(length = 8): string {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) out += SLUG_ALPHABET[bytes[i] % SLUG_ALPHABET.length];
  return out;
}

export function newWebId(): number {
  // 40 случайных бит: результат остаётся далеко внутри Number.MAX_SAFE_INTEGER.
  const bytes = crypto.randomBytes(5);
  let value = 0;
  for (const byte of bytes) value = value * 256 + byte;
  return SYNTHETIC_BASE - value;
}

export function newToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Выдать группе новый свободный код, заменив прежний.
 *
 * Старый код и собранная на нём ссылка перестают работать — это и есть смысл
 * смены: код мог разойтись дальше группы.
 */
export async function regenerateSlug(chatId: number, exec?: Exec): Promise<string> {
  const db = ex(exec);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = newSlug();
    const [taken] = await db
      .select({ slug: chats.slug })
      .from(chats)
      .where(eq(chats.slug, candidate))
      .limit(1);
    if (!taken) {
      await db.update(chats).set({ slug: candidate }).where(eq(chats.chatId, chatId));
      return candidate;
    }
  }
  throw new Error("Не удалось подобрать свободный слаг");
}

/** Выдать группе публичный слаг, если его ещё нет. */
export async function ensureSlug(chat: Chat, exec?: Exec): Promise<string> {
  if (chat.slug) return chat.slug;
  return regenerateSlug(chat.chatId, exec);
}

/** Группа, созданная на сайте, без Telegram-чата. */
export async function createWebChat(
  args: { title: string; tz?: string; lang?: string },
  exec?: Exec,
): Promise<Chat> {
  const db = ex(exec);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const slug = newSlug();
    const [taken] = await db
      .select({ slug: chats.slug })
      .from(chats)
      .where(eq(chats.slug, slug))
      .limit(1);
    if (taken) continue;
    const [row] = await db
      .insert(chats)
      .values({
        chatId: newWebId(),
        slug,
        title: args.title.slice(0, 200) || "Группа",
        origin: "web",
        tz: args.tz ?? "Asia/Almaty",
        lang: args.lang ?? "ru",
      })
      .returning();
    return row;
  }
  throw new Error("Не удалось подобрать свободный слаг");
}

export async function createWebUser(
  args: { fullName: string; lang?: string },
  exec?: Exec,
): Promise<User> {
  const [row] = await ex(exec)
    .insert(users)
    .values({
      userId: newWebId(),
      username: null,
      fullName: args.fullName.slice(0, 120) || "Аноним",
      lang: args.lang ?? "ru",
      isWeb: true,
    })
    .returning();
  return row;
}

export async function issueWebSession(userId: number, exec?: Exec): Promise<string> {
  const token = newToken();
  await ex(exec).insert(webSessions).values({ token, userId });
  return token;
}

export async function deleteWebSession(token: string, exec?: Exec): Promise<void> {
  if (!token) return;
  await ex(exec).delete(webSessions).where(eq(webSessions.token, token));
}

export async function userByWebToken(token: string, exec?: Exec): Promise<User | null> {
  if (!token) return null;
  const db = ex(exec);
  const [session] = await db
    .select()
    .from(webSessions)
    .where(eq(webSessions.token, token))
    .limit(1);
  if (!session) return null;
  await db
    .update(webSessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(webSessions.token, token));
  return getUser(session.userId, db);
}
