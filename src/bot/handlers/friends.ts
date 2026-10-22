/**
 * Друзья в боте: кнопки под уведомлениями (lib/friendNotify) и /friends.
 *
 *   fr:a:<id> / fr:d:<id> — принять или отклонить заявку в друзья;
 *   gi:a:<id> / gi:d:<id> — вступить в группу по приглашению или отказаться;
 *   ga:a:<id> / ga:d:<id> — впустить друга, который просится в группу, или отказать.
 *
 * Номер в кнопке ничего не решает: отвечать может только адресат (это
 * проверяет lib/friends по человеку, нажавшему кнопку), а мёртвое или чужое
 * приглашение просто «уже неактуально».
 */

import "server-only";

import { escapeHtml } from "@/core/textutils";
import * as repo from "@/db/repo";
import { t } from "@/i18n";
import * as friends from "@/lib/friends";
import { whoHtml } from "@/lib/friendNotify";
import { answerCallbackQuery, editMessageText, keyboard, sendMessage, type TgCallbackQuery, type TgMessage } from "../api";
import { syncUser } from "../context";
import { webAppButton } from "../site";

const BUTTON_RE = /^(fr|gi|ga):([ad]):(\d{1,10})$/;

export function isFriendCallback(data: string): boolean {
  return BUTTON_RE.test(data);
}

/** Ответ кнопкой под уведомлением. */
export async function onFriendButton(query: TgCallbackQuery): Promise<void> {
  const match = BUTTON_RE.exec(query.data ?? "");
  const me = match ? await repo.getUser(query.from.id) : null;
  const lang = me?.lang || "ru";
  if (!match || !me || me.isWeb) {
    await answerCallbackQuery({ callback_query_id: query.id, text: t(lang, "fr_bot_gone"), show_alert: true });
    return;
  }
  const [, kind, action, rawId] = match;
  const accept = action === "a";
  const id = Number(rawId);

  let text: string;
  let toast: string;
  if (kind === "fr") {
    const outcome = await friends.answerFriendRequest(me, id, accept);
    if (outcome.code === "gone") {
      toast = t(lang, "fr_bot_gone");
      text = t(lang, "fr_bot_gone");
    } else {
      const other = outcome.other ?? (await requestPeer(id));
      toast = t(lang, outcome.code === "accepted" ? "fr_bot_accepted" : "fr_bot_declined");
      text = other
        ? t(lang, outcome.code === "accepted" ? "fr_bot_accepted_who" : "fr_bot_declined_who", { who: whoHtml(other) })
        : toast;
    }
  } else {
    const outcome = await friends.answerGroupInvite(me, id, accept);
    const group = outcome.chat ? `<b>${escapeHtml(outcome.chat.title)}</b>` : "—";
    const key =
      outcome.code === "joined"
        ? "fr_bot_joined"
        : outcome.code === "approved"
          ? "fr_bot_approved"
          : outcome.code === "declined"
            ? "fr_bot_refused"
            : `fr_bot_${outcome.code}`;
    text = t(lang, key, { group });
    toast = text.replace(/<[^>]+>/g, "");
  }

  await answerCallbackQuery({ callback_query_id: query.id, text: toast.slice(0, 190) });
  if (query.message) {
    await editMessageText({
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      text,
      parse_mode: "HTML",
      reply_markup: siteMarkup(lang),
    }).catch(() => {
      // Сообщение могли удалить или уже отредактировать — ответ всё равно записан.
    });
  }
}

/** Кто отправил заявку — для текста после отказа (lib/friends возвращает его только при согласии). */
async function requestPeer(requestId: number) {
  const request = await repo.getFriendRequest(requestId);
  return request ? repo.getUser(request.fromUser) : null;
}

function siteMarkup(lang: string) {
  const button = webAppButton(t(lang, "fr_btn_open"), "/friends");
  return button ? keyboard([[button]]) : undefined;
}

/** /friends — кнопка в раздел «Друзья» на сайте. */
export async function cmdFriends(message: TgMessage): Promise<void> {
  if (!message.from) return;
  const user = await syncUser(message.from);
  const lang = user.lang;
  await sendMessage({
    chat_id: message.chat.id,
    text: t(lang, "fr_bot_friends"),
    parse_mode: "HTML",
    reply_markup: siteMarkup(lang),
  });
}

/** /start f_<код> — чужая личная ссылка, открытая не мини-аппом, а ссылкой на бота. */
export async function startFriendLink(message: TgMessage, code: string): Promise<void> {
  if (!message.from) return;
  const user = await syncUser(message.from);
  const lang = user.lang;
  const found = await friends.linkOwner(code);
  // Владелец заблокировал пришедшего — ссылка для него «не работает», как устаревшая.
  const rel = found ? await friends.relationOf(user.userId, found.userId) : null;
  const owner = found && !rel?.blockedMe ? found : null;
  const button = owner ? webAppButton(t(lang, "fr_btn_add"), `/f/${code}`) : null;
  await sendMessage({
    chat_id: message.chat.id,
    text: owner ? t(lang, "fr_bot_link", { who: whoHtml(owner) }) : t(lang, "fr_bot_link_dead"),
    parse_mode: "HTML",
    reply_markup: button ? keyboard([[button]]) : undefined,
  });
}
