/**
 * Клиент Telegram Bot API.
 *
 * Прямые вызовы `fetch` вместо библиотеки: на Vercel живёт не процесс, а
 * функция на один апдейт, поэтому от `python-telegram-bot` пригодилась бы
 * ровно эта тонкая обёртка, а всё остальное (очередь задач, персистентность,
 * long polling) там всё равно не работает.
 */

import "server-only";

import { botToken } from "@/lib/config";

export type InlineButton = {
  text: string;
  url?: string;
  callback_data?: string;
  /** Открыть сайт как Mini App: Telegram передаст подписанный initData и вход произойдёт сам. Только в личке. */
  web_app?: { url: string };
};

export type InlineKeyboardMarkup = { inline_keyboard: InlineButton[][] };
export type ForceReplyMarkup = { force_reply: true; selective?: boolean };
export type ReplyMarkup = InlineKeyboardMarkup | ForceReplyMarkup;

export type TgUser = {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
};

export type TgChat = {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
};

export type TgMessageEntity = {
  type: string;
  offset: number;
  length: number;
  user?: TgUser;
};

export type TgMessage = {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  date: number;
  text?: string;
  caption?: string;
  entities?: TgMessageEntity[];
  caption_entities?: TgMessageEntity[];
  reply_to_message?: TgMessage;
};

export type TgCallbackQuery = {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
};

export type TgChatMemberUpdated = {
  chat: TgChat;
  from: TgUser;
  new_chat_member: { user: TgUser; status: string };
  old_chat_member: { user: TgUser; status: string };
};

export type TgUpdate = {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
  callback_query?: TgCallbackQuery;
  my_chat_member?: TgChatMemberUpdated;
};

export class TelegramError extends Error {
  constructor(
    readonly method: string,
    readonly code: number,
    readonly description: string,
  ) {
    super(`${method}: ${code} ${description}`);
  }

  /** Бот не может написать первым, пока человек не нажал /start. */
  get isForbidden(): boolean {
    return this.code === 403;
  }
}

async function call<T>(method: string, payload: unknown, token = botToken()): Promise<T> {
  if (!token) throw new TelegramError(method, 0, "BOT_TOKEN не задан");

  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const body = (await response.json()) as
    | { ok: true; result: T }
    | { ok: false; error_code: number; description: string };

  if (!body.ok) throw new TelegramError(method, body.error_code, body.description);
  return body.result;
}

/** Вызов, который не должен ронять обработку апдейта (например, «сообщение не изменилось»). */
export async function tryCall<T>(
  method: string,
  payload: unknown,
): Promise<T | null> {
  try {
    return await call<T>(method, payload);
  } catch {
    return null;
  }
}

export function sendMessage(payload: {
  chat_id: number;
  text: string;
  parse_mode?: "HTML";
  reply_markup?: ReplyMarkup;
  reply_to_message_id?: number;
  link_preview_options?: { is_disabled: boolean };
}): Promise<TgMessage> {
  return call<TgMessage>("sendMessage", payload);
}

export function editMessageText(payload: {
  chat_id: number;
  message_id: number;
  text: string;
  parse_mode?: "HTML";
  reply_markup?: InlineKeyboardMarkup;
  link_preview_options?: { is_disabled: boolean };
}): Promise<TgMessage | null> {
  // Telegram отвечает ошибкой, если текст и клавиатура не изменились, — это не сбой.
  return tryCall<TgMessage>("editMessageText", payload);
}

export function editMessageReplyMarkup(payload: {
  chat_id: number;
  message_id: number;
  reply_markup?: InlineKeyboardMarkup;
}): Promise<TgMessage | null> {
  return tryCall<TgMessage>("editMessageReplyMarkup", payload);
}

export function answerCallbackQuery(payload: {
  callback_query_id: string;
  text?: string;
  show_alert?: boolean;
}): Promise<boolean | null> {
  return tryCall<boolean>("answerCallbackQuery", payload);
}

export function getChatMember(payload: {
  chat_id: number;
  user_id: number;
}): Promise<{ status: string } | null> {
  return tryCall<{ status: string }>("getChatMember", payload);
}

/**
 * Все администраторы чата одним вызовом.
 *
 * Бросает ошибку, а не глотает её, как tryCall: вызывающему важно отличить
 * «Telegram ответил, что бота в чате нет» (TelegramError 400/403 — список
 * админов пуст) от «сеть недоступна» (любая другая ошибка — список неизвестен).
 */
export function getChatAdministrators(payload: {
  chat_id: number;
}): Promise<{ status: string; user: TgUser }[]> {
  return call<{ status: string; user: TgUser }[]>("getChatAdministrators", payload);
}

export function getMe(token?: string): Promise<TgUser> {
  return call<TgUser>("getMe", {}, token ?? botToken());
}

export function setMyCommands(payload: {
  commands: { command: string; description: string }[];
  scope?: { type: string };
}): Promise<boolean> {
  return call<boolean>("setMyCommands", payload);
}

/** Кнопка меню рядом с полем ввода в личке с ботом: открывает сайт как Mini App. */
export function setChatMenuButton(payload: {
  menu_button: { type: "web_app"; text: string; web_app: { url: string } } | { type: "commands" };
}): Promise<boolean> {
  return call<boolean>("setChatMenuButton", payload);
}

/** Отправка файла требует multipart — единственный вызов, где JSON не годится. */
export async function sendDocument(payload: {
  chat_id: number;
  filename: string;
  content: string;
  mime: string;
  caption?: string;
}): Promise<boolean> {
  const token = botToken();
  if (!token) return false;

  const form = new FormData();
  form.set("chat_id", String(payload.chat_id));
  form.set("document", new Blob([payload.content], { type: payload.mime }), payload.filename);
  if (payload.caption) form.set("caption", payload.caption);

  const response = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: "POST",
    body: form,
    cache: "no-store",
  });
  return response.ok;
}

export function keyboard(rows: InlineButton[][]): InlineKeyboardMarkup {
  return { inline_keyboard: rows };
}

export const FORCE_REPLY: ForceReplyMarkup = { force_reply: true, selective: true };

export function isGroup(chat: TgChat | undefined): boolean {
  return chat?.type === "group" || chat?.type === "supergroup";
}

export function isPrivate(chat: TgChat | undefined): boolean {
  return chat?.type === "private";
}

export function fullName(user: TgUser): string {
  return [user.first_name, user.last_name].filter(Boolean).join(" ") || user.first_name || "";
}
