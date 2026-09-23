/**
 * Кнопки, ведущие из бота на сайт.
 *
 * Бот теперь в основном рассылает уведомления, а всё остальное делается на
 * сайте. В личке сайт открывается как Mini App: Telegram сам передаёт
 * подписанные данные пользователя, и вход происходит без пароля и без
 * подтверждений. В группах Mini App-кнопки запрещены — там кнопка ведёт в
 * личку с ботом, а уже оттуда открывается сайт. Если у бота есть главное
 * мини-приложение, кнопка группы открывает его сразу, ссылкой `?startapp=`.
 */

import "server-only";

import * as repo from "@/db/repo";
import type { Chat } from "@/db/schema";
import { t } from "@/i18n";
import { siteUrl } from "@/lib/config";
import type { InlineButton } from "./api";
import { botInfo, botUsername } from "./context";

/** Адрес страницы сайта или null, если сайт не настроен. */
export function sitePage(path = "/"): string | null {
  const base = siteUrl();
  if (!base) return null;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Путь группы на сайте. */
export function groupPath(chat: Pick<Chat, "slug">, suffix = ""): string {
  return chat.slug ? `/g/${chat.slug}${suffix}` : "/";
}

/**
 * Кнопка сайта для личного сообщения. Mini App требует https — на локальном
 * http-адресе остаётся обычная ссылка.
 */
export function webAppButton(text: string, path = "/"): InlineButton | null {
  const url = sitePage(path);
  if (!url) return null;
  return url.startsWith("https://") ? { text, web_app: { url } } : { text, url };
}

/** Кнопка в групповом чате: открыть личку с ботом и сразу привязаться к этому чату. */
export async function joinViaBotButton(lang: string, chatId: number, key = "btn_fill_schedule"): Promise<InlineButton> {
  return { text: t(lang, key), url: `https://t.me/${await botUsername()}?start=c${chatId}` };
}

/**
 * Приглашение, которое открывает группу сразу в мини-приложении: одно касание
 * вместо «личка с ботом → Start → кнопка». Код группы уходит в start_param,
 * мини-апп по нему вступает сам (TelegramAuth, OpenLastGroup). Только если у
 * бота включено главное мини-приложение, иначе null.
 */
export async function miniAppInvite(slug: string): Promise<string | null> {
  const bot = await botInfo();
  return bot.hasMainWebApp && bot.username ? `https://t.me/${bot.username}?startapp=${slug}` : null;
}

/** Главная кнопка под сообщениями бота в группе: с мини-приложением — сразу в нём. */
export async function openGroupButton(lang: string, chatId: number, key = "btn_fill_schedule"): Promise<InlineButton> {
  const chat = await repo.getChat(chatId);
  const invite = chat ? await miniAppInvite(await repo.ensureSlug(chat)) : null;
  return invite ? { text: t(lang, key), url: invite } : joinViaBotButton(lang, chatId, key);
}
