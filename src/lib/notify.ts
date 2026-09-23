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
import { groupPath, webAppButton } from "@/bot/site";
import { escapeHtml } from "@/core/textutils";
import * as repo from "@/db/repo";
import { type Chat, type Meeting, type User, displayName } from "@/db/schema";
import { t } from "@/i18n";
import { isTelegramChat } from "./admin";
import { hasBot } from "./config";

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

/** Кнопка группы на сайте для личного сообщения — открывается как Mini App, вход сам. */
function siteButton(chat: Chat, lang: string, key = "btn_open_group_site", suffix = "") {
  return chat.slug ? webAppButton(t(lang, key), groupPath(chat, suffix)) : null;
}

function withSiteButton(markup: InlineKeyboardMarkup, chat: Chat, lang: string): InlineKeyboardMarkup {
  const button = siteButton(chat, lang);
  if (!button) return markup;
  return keyboard([...markup.inline_keyboard, [button]]);
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

  if (voter.userId === meeting.initiatorId) return;
  if (answer === "change") await notifyChangeProposal(chat, meeting, voter, comment);
  else if (answer === "yes" || answer === "maybe" || answer === "no") {
    await notifyOrganizerAnswer(chat, meeting, voter, answer);
  }
}

/**
 * Обратная связь организатору: кто ответил «да» или «нет» и сколько уже
 * согласились. Только личным сообщением — баннеров на сайте на каждый голос
 * не создаём, там и так видна карточка встречи.
 */
export async function notifyOrganizerAnswer(
  chat: Chat,
  meeting: Meeting,
  voter: Pick<User, "userId" | "fullName" | "username" | "realName">,
  answer: "yes" | "maybe" | "no",
): Promise<boolean> {
  if (voter.userId === meeting.initiatorId) return false;
  const initiator = await repo.getUser(meeting.initiatorId);
  if (!initiator) return false;

  const responses = await repo.meetingResponsesFor(meeting.id);
  const lang = initiator.lang || chat.lang;
  const key =
    answer === "yes" ? "notify_answer_yes" : answer === "maybe" ? "notify_answer_maybe" : "notify_answer_no";
  const text = t(lang, key, {
    name: escapeHtml(displayName(voter)),
    goal: escapeHtml(meeting.goal || meeting.whenText || "—"),
    yes: responses.filter((row) => row.answer === "yes").length,
    total: repo.inviteeIds(meeting).length,
  });
  const button = siteButton(chat, lang);
  return directMessage(initiator, text, button ? keyboard([[button]]) : undefined);
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
  const button = siteButton(chat, chat.lang);
  if (await directMessage(initiator, text, button ? keyboard([[button]]) : undefined)) return;

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

/**
 * Итоги прошедшей встречи — тем приглашённым, кто не собирался прийти или
 * не ответил: пришедшие и так знают, что решили.
 */
export async function notifySummary(
  chat: Chat,
  meeting: Meeting,
  author: User,
  summary: string,
): Promise<Delivery> {
  const delivery: Delivery = { telegram: 0, site: 0 };
  const going = new Set(
    (await repo.meetingResponsesFor(meeting.id)).filter((row) => row.answer === "yes").map((row) => row.userId),
  );
  const targets = repo.inviteeIds(meeting).filter((id) => !going.has(id) && id !== author.userId);
  if (targets.length === 0) return delivery;

  const byId = await repo.usersByIds(targets);
  const text = t(chat.lang, "notify_summary", {
    name: escapeHtml(displayName(author)),
    goal: escapeHtml(meeting.goal || meeting.whenText || "—"),
    summary: escapeHtml(summary),
  });
  const button = siteButton(chat, chat.lang);
  const siteRows: Parameters<typeof repo.addNotices>[0] = [];
  for (const id of targets) {
    const user = byId.get(id);
    if (!user) continue;
    if (await directMessage(user, text, button ? keyboard([[button]]) : undefined)) {
      delivery.telegram += 1;
      continue;
    }
    siteRows.push({
      chatId: chat.chatId,
      userId: id,
      kind: "summary",
      meetingId: meeting.id,
      fromUserId: author.userId,
      text: meeting.goal,
    });
  }
  await repo.addNotices(siteRows);
  delivery.site = siteRows.length;
  return delivery;
}

/**
 * Конфликт расписания: человек идёт на встречу, но теперь в это время занят.
 * Пишем ему самому и создателю встречи; кого не достать ботом — баннером.
 */
export async function notifyConflict(chat: Chat, meeting: Meeting, user: User, when: string): Promise<void> {
  const goal = escapeHtml(meeting.goal || meeting.whenText || "—");
  const button = siteButton(chat, chat.lang);
  const markup = button ? keyboard([[button]]) : undefined;

  const self = t(chat.lang, "notify_conflict_self", { goal, when: escapeHtml(when) });
  if (!(await directMessage(user, self, markup))) {
    await repo.addNotices([
      { chatId: chat.chatId, userId: user.userId, kind: "conflict", meetingId: meeting.id, text: meeting.goal },
    ]);
  }

  if (meeting.initiatorId === user.userId) return;
  const initiator = await repo.getUser(meeting.initiatorId);
  if (!initiator) return;
  const other = t(chat.lang, "notify_conflict_other", {
    name: escapeHtml(displayName(user)),
    goal,
    when: escapeHtml(when),
  });
  if (await directMessage(initiator, other, markup)) return;
  await repo.addNotices([
    {
      chatId: chat.chatId,
      userId: initiator.userId,
      kind: "conflict_other",
      meetingId: meeting.id,
      fromUserId: user.userId,
      text: meeting.goal,
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
  /** «semester» — начался новый семестр: расписание есть, но устарело. */
  reason: "fill" | "semester" = "fill",
): Promise<Delivery> {
  const delivery: Delivery = { telegram: 0, site: 0 };
  if (targets.length === 0) return delivery;

  const viaTelegram = targets.filter(reachableByBot);
  const siteOnly: User[] = targets.filter((user) => !reachableByBot(user));

  if (viaTelegram.length > 0 && isTelegramChat(chat)) {
    try {
      await sendMessage({
        chat_id: chat.chatId,
        text: t(chat.lang, reason === "semester" ? "remind_semester_text" : "remind_text", {
          names: mentionList(viaTelegram),
        }),
        parse_mode: "HTML",
        reply_markup: await setupKeyboard(chat.chatId, chat.lang),
      });
      delivery.telegram = viaTelegram.length;
    } catch (error) {
      if (!(error instanceof TelegramError)) console.error("notify: group remind", error);
      siteOnly.push(...viaTelegram);
    }
  } else if (viaTelegram.length > 0) {
    const text = t(chat.lang, reason === "semester" ? "notify_semester_dm" : "notify_fill_dm", {
      name: escapeHtml(displayName(from)),
      chat: escapeHtml(chat.title),
    });
    const button = siteButton(chat, chat.lang, "btn_fill_schedule", "/me");
    const markup = button ? keyboard([[button]]) : undefined;
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
      // Текст уведомления на сайте зависит от причины.
      text: reason === "semester" ? "semester" : "",
    })),
  );
  delivery.site = siteOnly.length;
  return delivery;
}
