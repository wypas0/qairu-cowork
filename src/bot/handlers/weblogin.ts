/** Вход на сайт через бота: /start login_<код> и кнопки подтверждения. */

import "server-only";

import { escapeHtml } from "@/core/textutils";
import { t } from "@/i18n";
import { decideLoginRequest, openLoginRequest } from "@/lib/tglogin";
import {
  answerCallbackQuery,
  editMessageText,
  isPrivate,
  keyboard,
  sendMessage,
  type TgCallbackQuery,
  type TgMessage,
} from "../api";
import { syncUser } from "../context";

const CALLBACK_PREFIX = "tgl:";

export async function startWebLogin(message: TgMessage, code: string): Promise<void> {
  const from = message.from;
  if (!from || !isPrivate(message.chat)) return;

  // Регистрация — это и есть запись пользователя из Telegram: имя и ник берутся оттуда.
  const user = await syncUser(from);
  const lang = user.lang;
  const opened = await openLoginRequest(code, from.id);

  if (!opened.ok) {
    await sendMessage({
      chat_id: message.chat.id,
      text: t(lang, `weblogin_${opened.reason}`),
      parse_mode: "HTML",
    });
    return;
  }

  const name = escapeHtml([from.first_name, from.last_name].filter(Boolean).join(" ") || String(from.id));
  await sendMessage({
    chat_id: message.chat.id,
    text: t(lang, "weblogin_confirm", {
      name,
      username: from.username ? ` (@${escapeHtml(from.username)})` : "",
      device: escapeHtml(opened.request.device),
    }),
    parse_mode: "HTML",
    reply_markup: keyboard([
      [
        { text: t(lang, "weblogin_btn_confirm"), callback_data: `${CALLBACK_PREFIX}ok:${code}` },
        { text: t(lang, "weblogin_btn_reject"), callback_data: `${CALLBACK_PREFIX}no:${code}` },
      ],
    ]),
  });
}

export async function onWebLoginButton(query: TgCallbackQuery): Promise<void> {
  const message = query.message;
  const [, action, code = ""] = (query.data ?? "").split(":");
  const user = await syncUser(query.from);
  const lang = user.lang;

  const result = await decideLoginRequest(code, query.from.id, action === "ok");

  if (result === "not_yours") {
    await answerCallbackQuery({
      callback_query_id: query.id,
      text: t(lang, "weblogin_not_yours"),
      show_alert: true,
    });
    return;
  }

  await answerCallbackQuery({ callback_query_id: query.id });
  if (!message) return;

  const text =
    result === "confirmed"
      ? t(lang, "weblogin_done")
      : result === "rejected"
        ? t(lang, "weblogin_rejected")
        : t(lang, `weblogin_${result}`);
  // Кнопки убираем в любом случае: второй раз нажимать нечего.
  await editMessageText({
    chat_id: message.chat.id,
    message_id: message.message_id,
    text,
    parse_mode: "HTML",
  });
}

export function isWebLoginCallback(data: string): boolean {
  return data.startsWith(CALLBACK_PREFIX);
}
