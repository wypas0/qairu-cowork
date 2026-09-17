/** Общие команды: /start, /help, /lang, /cancel и ответ на команды, переехавшие на сайт. */

import "server-only";

import * as repo from "@/db/repo";
import { LANG_NAMES, t } from "@/i18n";
import {
  answerCallbackQuery,
  editMessageText,
  isGroup,
  keyboard,
  sendMessage,
  type InlineButton,
  type TgCallbackQuery,
  type TgMessage,
} from "../api";
import { normalizeCode } from "@/lib/invite";
import { isChatAdmin, resolveLang, syncUser } from "../context";
import { groupPath, joinViaBotButton, sitePage, webAppButton } from "../site";
import { startWebLogin } from "./weblogin";

const DEEP_LINK_RE = /^c(-?\d+)$/;
const LOGIN_LINK_RE = /^login_([A-Za-z0-9_-]{16,40})$/;

function rows(...buttons: (InlineButton | null)[]) {
  return keyboard(buttons.filter((button): button is InlineButton => button !== null).map((button) => [button]));
}

/** /start в личке. Поддерживает deep-link t.me/bot?start=c<chat_id> и вход на сайт login_<код>. */
export async function cmdStart(message: TgMessage, args: string[]): Promise<void> {
  const from = message.from;
  if (!from) return;

  // Ссылка «Войти через Telegram» с сайта.
  const login = LOGIN_LINK_RE.exec(args[0] ?? "");
  if (login) {
    await startWebLogin(message, login[1]);
    return;
  }

  const user = await syncUser(from);
  const lang = user.lang;

  const match = DEEP_LINK_RE.exec(args[0] ?? "");
  const chat = match ? await repo.getChat(Number(match[1])) : null;
  if (chat) {
    await repo.addMembership(chat.chatId, from.id);
    const slug = await repo.ensureSlug(chat);
    await sendMessage({
      chat_id: message.chat.id,
      text: t(lang, "start_linked", { chat: chat.title || String(chat.chatId) }),
      parse_mode: "HTML",
      reply_markup: rows(webAppButton(t(lang, "btn_fill_schedule"), groupPath({ slug }, "/me"))),
    });
    return;
  }

  await sendMessage({
    chat_id: message.chat.id,
    text: t(lang, "start_private", { name: from.first_name ?? "" }),
    parse_mode: "HTML",
    reply_markup: rows(webAppButton(t(lang, "btn_open_site"), "/")),
  });
}

export async function cmdHelp(message: TgMessage): Promise<void> {
  const lang = await resolveLang(message.chat, message.from);
  const group = isGroup(message.chat);
  await sendMessage({
    chat_id: message.chat.id,
    text: t(lang, group ? "help_group" : "help_private"),
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: group ? undefined : rows(webAppButton(t(lang, "btn_open_site"), "/")),
  });
}

/**
 * Команда, которой больше нет в боте: расписание, окна в личке, настройки и
 * выход из группы теперь на сайте. Отвечаем кнопкой туда, а не молчанием.
 */
export async function cmdMovedToSite(message: TgMessage): Promise<void> {
  const lang = await resolveLang(message.chat, message.from);

  if (isGroup(message.chat)) {
    const chat = await repo.getChat(message.chat.id);
    const url = chat?.slug ? sitePage(groupPath(chat)) : null;
    await sendMessage({
      chat_id: message.chat.id,
      text: t(lang, "moved_to_site_group"),
      parse_mode: "HTML",
      reply_markup: url
        ? keyboard([[{ text: t(lang, "btn_open_group_site"), url }]])
        : keyboard([[await joinViaBotButton(lang, message.chat.id, "btn_open_bot")]]),
    });
    return;
  }

  // Код группы, присланный сообщением: «7KQ4 MZPD» или целая ссылка с сайта.
  // Так в группу попадают те, кому код продиктовали в аудитории.
  const code = normalizeCode(message.text ?? "");
  const byCode = code ? await repo.getChatBySlug(code) : null;
  if (byCode && message.from) {
    await syncUser(message.from);
    await repo.addMembership(byCode.chatId, message.from.id);
    await sendMessage({
      chat_id: message.chat.id,
      text: t(lang, "start_linked", { chat: byCode.title || String(byCode.chatId) }),
      parse_mode: "HTML",
      reply_markup: rows(
        webAppButton(t(lang, "btn_fill_schedule"), groupPath(byCode, "/me")),
      ),
    });
    return;
  }

  const chats = message.from ? await repo.userChats(message.from.id) : [];
  const target = chats.length === 1 && chats[0].slug ? groupPath(chats[0], "/me") : "/";
  await sendMessage({
    chat_id: message.chat.id,
    text: t(lang, "moved_to_site"),
    parse_mode: "HTML",
    reply_markup: rows(webAppButton(t(lang, "btn_open_site"), target)),
  });
}

export async function cmdLang(message: TgMessage): Promise<void> {
  const lang = await resolveLang(message.chat, message.from);

  if (isGroup(message.chat) && !(await isChatAdmin(message.chat, message.from))) {
    await sendMessage({ chat_id: message.chat.id, text: t(lang, "only_admin") });
    return;
  }

  await sendMessage({
    chat_id: message.chat.id,
    text: t(lang, "choose_lang"),
    reply_markup: keyboard(
      Object.entries(LANG_NAMES).map(([code, title]) => [
        { text: title, callback_data: `lang:${code}` },
      ]),
    ),
  });
}

export async function onLangChoice(query: TgCallbackQuery): Promise<void> {
  const message = query.message;
  if (!message) return;
  const newLang = (query.data ?? "").split(":")[1] ?? "ru";

  if (isGroup(message.chat) && !(await isChatAdmin(message.chat, query.from))) {
    const lang = await resolveLang(message.chat, query.from);
    await answerCallbackQuery({
      callback_query_id: query.id,
      text: t(lang, "only_admin"),
      show_alert: true,
    });
    return;
  }

  await syncUser(query.from);
  await repo.setUserLang(query.from.id, newLang);
  if (isGroup(message.chat)) {
    await repo.upsertChat(message.chat.id, message.chat.title ?? "");
    await repo.updateChat(message.chat.id, { lang: newLang });
  }

  await answerCallbackQuery({ callback_query_id: query.id });
  await editMessageText({
    chat_id: message.chat.id,
    message_id: message.message_id,
    text: t(newLang, "lang_set"),
  });
}

/** Старые кнопки мастера расписания из прошлых сообщений: объясняем, куда всё переехало. */
export async function onRetiredButton(query: TgCallbackQuery): Promise<void> {
  const lang = await resolveLang(query.message?.chat, query.from);
  await answerCallbackQuery({
    callback_query_id: query.id,
    text: t(lang, "moved_to_site_alert"),
    show_alert: true,
  });
}

export async function cmdCancel(message: TgMessage): Promise<void> {
  const lang = await resolveLang(message.chat, message.from);
  if (message.from) await repo.deleteBotState(`mtg:${message.chat.id}:${message.from.id}`);
  await sendMessage({ chat_id: message.chat.id, text: t(lang, "cancelled") });
}
