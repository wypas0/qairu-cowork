/**
 * Уведомления о друзьях: заявка, ответ на неё, добавление по ссылке,
 * приглашение в группу, просьба вступить и ответ на неё.
 *
 * Личным сообщением от бота — с кнопками «Принять / Отклонить» прямо под ним
 * (их обрабатывает bot/handlers/friends) и кнопкой сайта. Кому бот написать
 * не может, ничего не теряет: всё ждёт его в «Друзьях», счётчик — на кнопке
 * профиля и в сайдбаре.
 *
 * Текста от отправителя в сообщениях нет: только имя, ник и название группы
 * — заявками нельзя рассылать спам и ссылки.
 */

import "server-only";

import { type InlineButton, keyboard, sendMessage, TelegramError } from "@/bot/api";
import { webAppButton } from "@/bot/site";
import { escapeHtml } from "@/core/textutils";
import type { Chat, User } from "@/db/schema";
import { t } from "@/i18n";
import { reachableByBot, whoHtml } from "./notify";

export { whoHtml };

async function direct(to: User, key: string, params: Record<string, string>, rows: (InlineButton | null)[][]): Promise<boolean> {
  if (!reachableByBot(to)) return false;
  const lang = to.lang || "ru";
  const buttons = rows.map((row) => row.filter((button): button is InlineButton => button !== null)).filter((row) => row.length);
  try {
    await sendMessage({
      chat_id: to.userId,
      text: t(lang, key, params),
      parse_mode: "HTML",
      reply_markup: buttons.length ? keyboard(buttons) : undefined,
      link_preview_options: { is_disabled: true },
    });
    return true;
  } catch (error) {
    // 403 — человек не запускал бота или заблокировал его: всё ждёт на сайте.
    if (!(error instanceof TelegramError)) console.error("friendNotify: sendMessage", error);
    return false;
  }
}

const openFriends = (lang: string, path = "/friends?tab=requests") => webAppButton(t(lang, "fr_btn_open"), path);

/** Новая заявка: принять или отклонить можно прямо в боте. */
export function notifyFriendRequest(to: User, from: User, requestId: number): Promise<boolean> {
  const lang = to.lang || "ru";
  return direct(to, "fr_request", { who: whoHtml(from) }, [
    [
      { text: t(lang, "fr_btn_accept"), callback_data: `fr:a:${requestId}` },
      { text: t(lang, "fr_btn_decline"), callback_data: `fr:d:${requestId}` },
    ],
    [openFriends(lang)],
  ]);
}

/** Заявку приняли — отправителю. */
export function notifyFriendAccepted(to: User, by: User): Promise<boolean> {
  const lang = to.lang || "ru";
  return direct(to, "fr_accepted", { who: whoHtml(by) }, [[openFriends(lang, `/friends/${by.userId}`)]]);
}

/** Кто-то добавился по личной ссылке — её владельцу: вдруг ссылка ушла не туда. */
export function notifyFriendByLink(to: User, by: User): Promise<boolean> {
  const lang = to.lang || "ru";
  return direct(to, "fr_by_link", { who: whoHtml(by) }, [[openFriends(lang, `/friends/${by.userId}`)]]);
}

/** Друг зовёт в группу. */
export function notifyGroupInvite(to: User, from: User, chat: Chat, inviteId: number): Promise<boolean> {
  const lang = to.lang || "ru";
  return direct(to, "fr_invite", { who: whoHtml(from), group: `<b>${escapeHtml(chat.title)}</b>` }, [
    [
      { text: t(lang, "fr_btn_join"), callback_data: `gi:a:${inviteId}` },
      { text: t(lang, "fr_btn_refuse"), callback_data: `gi:d:${inviteId}` },
    ],
    [openFriends(lang)],
  ]);
}

/** Друг просится в группу — участнику, у которого просят. */
export function notifyGroupAsk(to: User, asker: User, chat: Chat, askId: number): Promise<boolean> {
  const lang = to.lang || "ru";
  return direct(to, "fr_ask", { who: whoHtml(asker), group: `<b>${escapeHtml(chat.title)}</b>` }, [
    [
      { text: t(lang, "fr_btn_let_in"), callback_data: `ga:a:${askId}` },
      { text: t(lang, "fr_btn_refuse"), callback_data: `ga:d:${askId}` },
    ],
    [openFriends(lang)],
  ]);
}

/** В группу приняли (по приглашению или по просьбе) — второй стороне. */
export function notifyJoinedByFriend(to: User, who: User, chat: Chat, key: "fr_invite_accepted" | "fr_ask_approved"): Promise<boolean> {
  const lang = to.lang || "ru";
  const button = chat.slug ? webAppButton(t(lang, "btn_open_group_site"), `/g/${chat.slug}`) : null;
  return direct(to, key, { who: whoHtml(who), group: `<b>${escapeHtml(chat.title)}</b>` }, [[button]]);
}
