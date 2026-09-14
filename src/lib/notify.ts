/**
 * Доставка уведомлений участникам: Telegram, а где он не дотягивается — сайт.
 *
 * Правило одно для всех сценариев. Человек с настоящим Telegram-аккаунтом
 * получает личное сообщение от бота. Если бот написать не смог (человек
 * ещё не нажал /start, заблокировал бота) или у человека вообще нет Telegram
 * (зарегистрирован на сайте), создаётся уведомление на сайте — баннер в группе.
 * Молча не теряется никто.
 */

import "server-only";

import {
  TelegramError,
  editMessageText,
  keyboard,
  sendMessage,
  type InlineKeyboardMarkup,
} from "@/bot/api";
import { mentionList } from "@/bot/context";
import { renderCard } from "@/bot/handlers/meeting";
import { setupKeyboard } from "@/bot/handlers/registration";
import { escapeHtml } from "@/core/textutils";
import * as repo from "@/db/repo";
import { type Chat, type Meeting, type User, displayName } from "@/db/schema";
import { t } from "@/i18n";
import { isTelegramChat } from "./admin";
import { hasBot, siteUrl } from "./config";

export type Delivery = { telegram: number; site: number };

/** Настоящий Telegram-пользователь: положительный id и не заведён на сайте. */
export function reachableByBot(user: Pick<User, "userId" | "isWeb">): boolean {
  return !user.isWeb && user.userId > 0 && hasBot();
}

async function directMessage(
  user: Pick<User, "userId" | "isWeb">,
  text: string,
  markup?: InlineKeyboardMarkup,
): Promise<boolean> {
  if (!reachableByBot(user)) return false;
  try {
    await sendMessage({
      chat_id: user.userId,
      text,
      parse_mode: "HTML",
      reply_markup: markup,
      link_preview_options: { is_disabled: true },
    });
    return true;
  } catch (error) {
    // 403 — бот не может написать первым; прочие сбои тоже не должны
    // ронять действие на сайте: уведомление уйдёт баннером.
    if (!(error instanceof TelegramError)) console.error("notify: sendMessage", error);
    return false;
  }
}

function groupUrl(chat: Chat, suffix = ""): string | null {
  const base = siteUrl();
  return base && chat.slug ? `${base}/g/${chat.slug}${suffix}` : null;
}

function withSiteButton(markup: InlineKeyboardMarkup, chat: Chat, lang: string): InlineKeyboardMarkup {
  const url = groupUrl(chat);
  if (!url) return markup;
  return keyboard([...markup.inline_keyboard, [{ text: t(lang, "btn_open_web"), url }]]);
}

/**
 * Новая встреча, созданная на сайте.
 *
 * В Telegram-группе карточка с голосованием публикуется в самом чате — это
 * видят все, и голоса оттуда и с сайта попадают в одну и ту же встречу.
 * В группе с сайта каждый приглашённый получает карточку лично.
 */
export async function notifyMeetingCreated(chat: Chat, meeting: Meeting): Promise<Delivery> {
  const delivery: Delivery = { telegram: 0, site: 0 };
  const lang = chat.lang;
  const invitees = repo.inviteeIds(meeting).filter((id) => id !== meeting.initiatorId);
  const byId = await repo.usersByIds(invitees);
  const initiator = await repo.getUser(meeting.initiatorId);
  const card = await renderCard(meeting.id, lang);

  let postedInGroup = false;
  if (isTelegramChat(chat) && hasBot()) {
    try {
      const sent = await sendMessage({
        chat_id: chat.chatId,
        text: card.text,
        parse_mode: "HTML",
        reply_markup: card.markup,
        link_preview_options: { is_disabled: true },
      });
      await repo.updateMeeting(meeting.id, { chatMessageId: sent.message_id });
      postedInGroup = true;
    } catch (error) {
      if (!(error instanceof TelegramError)) console.error("notify: group card", error);
    }
  }

  const intro = t(lang, "notify_meeting_new", {
    chat: escapeHtml(chat.title),
    name: escapeHtml(initiator ? displayName(initiator) : "—"),
  });
  const dmMarkup = withSiteButton(card.markup, chat, lang);
  const siteRows: Parameters<typeof repo.addNotices>[0] = [];

  for (const id of invitees) {
    const user = byId.get(id);
    if (!user) continue;
    if (postedInGroup && reachableByBot(user)) {
      delivery.telegram += 1;
      continue;
    }
    if (await directMessage(user, `${intro}\n\n${card.text}`, dmMarkup)) {
      delivery.telegram += 1;
      continue;
    }
    siteRows.push({
      chatId: chat.chatId,
      userId: id,
      kind: "meeting",
      meetingId: meeting.id,
      fromUserId: meeting.initiatorId,
      text: meeting.goal,
    });
  }
  await repo.addNotices(siteRows);
  delivery.site = siteRows.length;
  return delivery;
}

/**
 * Кто-то ответил на встречу с сайта.
 *
 * Карточка в Telegram-чате перерисовывается, чтобы голоса не расходились.
 * На «предложить изменения» организатор получает уведомление — иначе
 * предложение так и осталось бы незамеченным.
 */
export async function notifyVote(
  chat: Chat,
  meeting: Meeting,
  voter: User,
  answer: string,
  comment: string,
): Promise<void> {
  await repo.markMeetingNoticesRead(meeting.id, voter.userId);

  if (meeting.chatMessageId && hasBot()) {
    const card = await renderCard(meeting.id, chat.lang);
    await editMessageText({
      chat_id: meeting.chatId,
      message_id: meeting.chatMessageId,
      text: card.text,
      parse_mode: "HTML",
      reply_markup: card.markup,
      link_preview_options: { is_disabled: true },
    });
  }

  if (answer === "change" && voter.userId !== meeting.initiatorId) {
    await notifyChangeProposal(chat, meeting, voter, comment);
  }
}

export async function notifyChangeProposal(
  chat: Chat,
  meeting: Meeting,
  voter: Pick<User, "userId" | "fullName" | "username">,
  comment: string,
): Promise<void> {
  const initiator = await repo.getUser(meeting.initiatorId);
  if (!initiator || initiator.userId === voter.userId) return;

  const text = t(chat.lang, "notify_change", {
    name: escapeHtml(displayName(voter)),
    goal: escapeHtml(meeting.goal || meeting.whenText || "—"),
    comment: escapeHtml(comment || "—"),
  });
  const url = groupUrl(chat);
  const markup = url ? keyboard([[{ text: t(chat.lang, "btn_open_web"), url }]]) : undefined;
  if (await directMessage(initiator, text, markup)) return;

  await repo.addNotices([
    {
      chatId: chat.chatId,
      userId: initiator.userId,
      kind: "meeting_change",
      meetingId: meeting.id,
      fromUserId: voter.userId,
      text: comment,
    },
  ]);
}

/** Напомнить приглашённым, которые ещё не ответили на встречу. */
export async function notifyNonResponders(
  chat: Chat,
  meeting: Meeting,
  from: User,
): Promise<Delivery> {
  const delivery: Delivery = { telegram: 0, site: 0 };
  const answered = new Set((await repo.meetingResponsesFor(meeting.id)).map((row) => row.userId));
  const waiting = repo.inviteeIds(meeting).filter((id) => !answered.has(id) && id !== from.userId);
  if (waiting.length === 0) return delivery;

  const byId = await repo.usersByIds(waiting);
  const card = await renderCard(meeting.id, chat.lang);
  const text = t(chat.lang, "notify_meeting_ping", {
    name: escapeHtml(displayName(from)),
    goal: escapeHtml(meeting.goal || "—"),
    when: escapeHtml(meeting.whenText || "—"),
  });
  const markup = withSiteButton(card.markup, chat, chat.lang);
  const siteRows: Parameters<typeof repo.addNotices>[0] = [];

  for (const id of waiting) {
    const user = byId.get(id);
    if (!user) continue;
    if (await directMessage(user, `${text}\n\n${card.text}`, markup)) {
      delivery.telegram += 1;
      continue;
    }
    siteRows.push({
      chatId: chat.chatId,
      userId: id,
      kind: "meeting",
      meetingId: meeting.id,
      fromUserId: from.userId,
      text: meeting.goal,
    });
  }
  await repo.addNotices(siteRows);
  delivery.site = siteRows.length;
  return delivery;
}

/**
 * Администратор просит заполнить расписание.
 *
 * В Telegram-группе — одно общее сообщение с упоминаниями (бережём лимиты
 * Telegram и не спамим в личку), как команда /remind. В группе с сайта —
 * личные сообщения. Кого не достать через Telegram — баннер на сайте.
 */
export async function notifyFillSchedule(
  chat: Chat,
  from: User,
  targets: readonly User[],
): Promise<Delivery> {
  const delivery: Delivery = { telegram: 0, site: 0 };
  if (targets.length === 0) return delivery;

  const viaTelegram = targets.filter(reachableByBot);
  const siteOnly: User[] = targets.filter((user) => !reachableByBot(user));

  if (viaTelegram.length > 0 && isTelegramChat(chat)) {
    try {
      await sendMessage({
        chat_id: chat.chatId,
        text: t(chat.lang, "remind_text", { names: mentionList(viaTelegram) }),
        parse_mode: "HTML",
        reply_markup: await setupKeyboard(chat.chatId, chat.lang),
      });
      delivery.telegram = viaTelegram.length;
    } catch (error) {
      if (!(error instanceof TelegramError)) console.error("notify: group remind", error);
      siteOnly.push(...viaTelegram);
    }
  } else if (viaTelegram.length > 0) {
    const text = t(chat.lang, "notify_fill_dm", {
      name: escapeHtml(displayName(from)),
      chat: escapeHtml(chat.title),
    });
    const url = groupUrl(chat, "/me");
    const markup = url ? keyboard([[{ text: t(chat.lang, "btn_fill_schedule"), url }]]) : undefined;
    for (const user of viaTelegram) {
      if (await directMessage(user, text, markup)) delivery.telegram += 1;
      else siteOnly.push(user);
    }
  }

  await repo.addNotices(
    siteOnly.map((user) => ({
      chatId: chat.chatId,
      userId: user.userId,
      kind: "fill_schedule",
      fromUserId: from.userId,
    })),
  );
  delivery.site = siteOnly.length;
  return delivery;
}
