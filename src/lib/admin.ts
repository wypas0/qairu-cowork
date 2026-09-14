/**
 * Администраторы группы.
 *
 * Кто админ:
 * - создатель группы на сайте (chats.created_by) — всегда, разжаловать нельзя;
 * - участник с ролью `admin` — назначен другим админом на сайте;
 * - в группах из Telegram — ещё и администраторы самого Telegram-чата.
 *   Их не записываем в БД, а спрашиваем у Telegram: так снятие админки в
 *   чате отражается на сайте само, без ручной синхронизации.
 */

import "server-only";

import { TelegramError, getChatAdministrators } from "@/bot/api";
import * as repo from "@/db/repo";
import { type Chat, ROLE_ADMIN } from "@/db/schema";
import { hasBot } from "./config";

/** Как долго доверять полученному от Telegram списку администраторов. */
const TG_ADMINS_TTL_MS = 10 * 60 * 1000;

type CachedAdmins = { ids: number[]; at: number };

/** Telegram-группа, где спрашивать администраторов имеет смысл. */
export function isTelegramChat(chat: Pick<Chat, "origin" | "chatId">): boolean {
  return chat.origin === "telegram" && chat.chatId < 0 && chat.chatId > -(10 ** 15);
}

/** Ответы Telegram, после которых список админов достоверно пуст: бота нет в чате. */
function botLostAccess(error: unknown): boolean {
  return error instanceof TelegramError && (error.code === 400 || error.code === 403);
}

/**
 * Администраторы Telegram-чата (кроме ботов), с кэшем в bot_state.
 *
 * - Telegram ответил списком — кэшируем его на TG_ADMINS_TTL_MS.
 * - Telegram ответил, что бота в чате нет (выгнали, чат удалён) — прав через
 *   Telegram больше ни у кого нет: кэшируем пустой список. Раньше в этом
 *   случае навсегда отдавался старый кэш, и снятый в Telegram админ оставался
 *   админом на сайте.
 * - Сеть недоступна или Telegram временно сбоит — отдаём последний известный
 *   список (сбой не должен на время отнимать права), но отметку времени
 *   обновляем, чтобы не долбить Telegram на каждой загрузке страницы.
 */
export async function telegramAdminIds(chat: Chat): Promise<number[]> {
  if (!isTelegramChat(chat) || !hasBot()) return [];
  const key = `tgadmins:${chat.chatId}`;
  const cached = await repo.getBotState<CachedAdmins>(key);
  if (cached && Date.now() - cached.at < TG_ADMINS_TTL_MS) return cached.ids;

  let ids: number[];
  try {
    const admins = await getChatAdministrators({ chat_id: chat.chatId });
    ids = Array.isArray(admins)
      ? admins.filter((admin) => !admin.user.is_bot).map((admin) => admin.user.id)
      : [];
  } catch (error) {
    ids = botLostAccess(error) ? [] : (cached?.ids ?? []);
  }
  await repo.setBotState(key, { ids, at: Date.now() } satisfies CachedAdmins);
  return ids;
}

export type AdminSource = "creator" | "site" | "telegram";

/** Почему человек админ (в порядке приоритета) или null, если не админ. */
export async function adminSource(chat: Chat, userId: number): Promise<AdminSource | null> {
  if (chat.createdBy !== null && chat.createdBy === userId) return "creator";
  if ((await repo.memberRole(chat.chatId, userId)) === ROLE_ADMIN) return "site";
  if ((await telegramAdminIds(chat)).includes(userId)) return "telegram";
  return null;
}

export async function isGroupAdmin(chat: Chat, userId: number): Promise<boolean> {
  return (await adminSource(chat, userId)) !== null;
}

/** Источник админства для всех участников разом — для списка участников. */
export async function adminSources(
  chat: Chat,
  roster: readonly repo.RosterEntry[],
): Promise<Map<number, AdminSource>> {
  const tgIds = new Set(await telegramAdminIds(chat));
  const result = new Map<number, AdminSource>();
  for (const entry of roster) {
    const id = entry.user.userId;
    if (chat.createdBy !== null && chat.createdBy === id) result.set(id, "creator");
    else if (entry.role === ROLE_ADMIN) result.set(id, "site");
    else if (tgIds.has(id)) result.set(id, "telegram");
  }
  return result;
}
