/**
 * Вспомогательные функции обработчиков: язык, упоминания, разбор аргументов,
 * состояние диалогов.
 *
 * Состояние живёт в таблице `bot_state`, а не в памяти процесса: между двумя
 * апдейтами одной беседы может пройти любая пауза, и обслуживать их будут
 * разные лямбды.
 */

import "server-only";

import { escapeHtml } from "@/core/textutils";
import * as repo from "@/db/repo";
import type { User } from "@/db/schema";
import { displayName } from "@/db/schema";
import { DEFAULT_LANG, normalizeLang } from "@/i18n";
import { getMe, getChatMember, isGroup, type TgChat, type TgMessage, type TgUser } from "./api";

const MENTION_RE = /@([A-Za-z0-9_]{4,32})/g;

/** Кликабельное упоминание, которое работает даже без username. */
export function mention(user: Pick<User, "userId" | "fullName" | "username">): string {
  const name = escapeHtml(
    user.fullName || (user.username ? `@${user.username}` : String(user.userId)),
  );
  return `<a href="tg://user?id=${user.userId}">${name}</a>`;
}

export function mentionList(people: readonly User[]): string {
  return people.length ? people.map(mention).join(", ") : "—";
}

export function plainNames(people: readonly User[]): string {
  return people.length ? people.map((person) => escapeHtml(displayName(person))).join(", ") : "—";
}

/** Язык: у группы — язык чата, в личке — язык пользователя. */
export async function resolveLang(chat?: TgChat, user?: TgUser): Promise<string> {
  if (isGroup(chat)) {
    const row = await repo.getChat(chat!.id);
    if (row) return row.lang;
  }
  if (user) {
    const row = await repo.getUser(user.id);
    if (row) return row.lang;
    return normalizeLang(user.language_code);
  }
  return DEFAULT_LANG;
}

export async function isChatAdmin(chat: TgChat | undefined, user: TgUser | undefined): Promise<boolean> {
  if (!chat || !user) return false;
  if (chat.type === "private") return true;
  const member = await getChatMember({ chat_id: chat.id, user_id: user.id });
  return member?.status === "creator" || member?.status === "administrator";
}

/** Записать/обновить пользователя из апдейта. Username меняется — обновляем всегда. */
export async function syncUser(user: TgUser, exec?: repo.Exec): Promise<User> {
  return repo.upsertUser(
    {
      userId: user.id,
      username: user.username ?? null,
      fullName: [user.first_name, user.last_name].filter(Boolean).join(" ") || user.first_name || "",
      lang: null,
    },
    exec,
  );
}

/**
 * Достать пользователей из аргументов команды.
 *
 * Возвращает найденных и ненайденные строки. Поддерживает и @username,
 * и text_mention (упоминание человека без username).
 */
export async function extractMentionedUsers(
  message: TgMessage | undefined,
): Promise<{ found: User[]; missing: string[] }> {
  if (!message) return { found: [], missing: [] };

  const found: User[] = [];
  const missing: string[] = [];
  const seen = new Set<number>();

  const text = message.text ?? message.caption ?? "";
  const entities = message.entities ?? message.caption_entities ?? [];

  for (const entity of entities) {
    if (entity.type === "text_mention" && entity.user) {
      const user = await repo.getUser(entity.user.id);
      if (user && !seen.has(user.userId)) {
        seen.add(user.userId);
        found.push(user);
      } else if (!user) {
        missing.push([entity.user.first_name, entity.user.last_name].filter(Boolean).join(" "));
      }
    }
  }

  for (const match of text.matchAll(MENTION_RE)) {
    const username = match[1];
    const user = await repo.findUserByUsername(username);
    if (user) {
      if (!seen.has(user.userId)) {
        seen.add(user.userId);
        found.push(user);
      }
    } else {
      missing.push(`@${username}`);
    }
  }

  return { found, missing };
}

/** Найти в аргументах команды число — минимальную длительность окна. */
export function extractMinDuration(args: string[], fallback: number): number {
  for (const arg of args) {
    if (/^\d+$/.test(arg)) {
      const value = Number(arg);
      if (value >= 5 && value <= 12 * 60) return value;
    }
  }
  return fallback;
}

/** Разбор `/command@bot arg1 arg2`. */
export function parseCommand(text: string): { command: string; args: string[] } | null {
  const match = /^\/([A-Za-z0-9_]+)(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match) return null;
  const rest = (match[3] ?? "").trim();
  return { command: match[1].toLowerCase(), args: rest ? rest.split(/\s+/) : [] };
}

/** Что сайту нужно знать о самом боте. */
export type BotInfo = {
  username: string;
  /** Главное мини-приложение включено (BotFather → Bot Settings → Configure Mini App). */
  hasMainWebApp: boolean;
  at: number;
};

/** Сведения о боте уточняются у Telegram не чаще раза в столько. */
const BOT_INFO_TTL_MS = 6 * 60 * 60 * 1000;
let cachedInfo: BotInfo | null = null;

function fresh(info: BotInfo | null | undefined): info is BotInfo {
  return !!info?.username && typeof info.at === "number" && Date.now() - info.at < BOT_INFO_TTL_MS;
}

/**
 * Имя бота и есть ли у него главное мини-приложение. Хранится в bot_state и
 * раз в 6 часов уточняется через getMe: включили мини-приложение в BotFather —
 * сайт это заметит сам (или сразу — после /api/telegram/setup).
 */
export async function botInfo(): Promise<BotInfo> {
  if (fresh(cachedInfo)) return cachedInfo;
  const stored = await repo.getBotState<Partial<BotInfo>>("bot:me");
  if (fresh(stored as BotInfo)) return (cachedInfo = stored as BotInfo);
  try {
    const me = await getMe();
    cachedInfo = { username: me.username ?? "", hasMainWebApp: me.has_main_web_app === true, at: Date.now() };
    if (cachedInfo.username) await repo.setBotState("bot:me", cachedInfo);
    return cachedInfo;
  } catch (error) {
    // Telegram недоступен — прежние сведения лучше, чем никаких.
    if (stored?.username) return { username: stored.username, hasMainWebApp: stored.hasMainWebApp === true, at: 0 };
    throw error;
  }
}

/** Забыть сведения о боте — следующий вызов спросит Telegram заново. */
export async function forgetBotInfo(): Promise<void> {
  cachedInfo = null;
  await repo.setBotState("bot:me", {});
}

/** Username бота — нужен для deep-link `t.me/<bot>?start=…`. */
export async function botUsername(): Promise<string> {
  return (await botInfo()).username;
}
