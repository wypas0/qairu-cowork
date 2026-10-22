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
  keyboard,
  sendMessage,
  type InlineKeyboardMarkup,
} from "@/bot/api";
import { mentionList } from "@/bot/context";
import { refreshCard, renderCard } from "@/bot/handlers/meeting";
import { setupKeyboard } from "@/bot/handlers/registration";
import { groupPath, webAppButton } from "@/bot/site";
import { pairPartner } from "@/core/pairPlan";
import { escapeHtml } from "@/core/textutils";
import * as repo from "@/db/repo";
import { type Chat, type Meeting, type User, displayName } from "@/db/schema";
import { t } from "@/i18n";
import { isTelegramChat } from "./admin";
import { whenTextFor } from "./group";
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
 * Кнопка сайта под сообщением о встрече: у группы — её страница, у встречи
 * вдвоём (`chat` = null) — карточка второго человека для того, кому пишем.
 */
function meetingButton(chat: Chat | null, meeting: Meeting, to: number, lang: string) {
  if (chat) return siteButton(chat, lang);
  const partner = pairPartner(meeting, to);
  return partner === null ? null : webAppButton(t(lang, "btn_open_friend"), `/friends/${partner}`);
}

const markupOf = (button: ReturnType<typeof meetingButton>) => (button ? keyboard([[button]]) : undefined);

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
 * Карточка в Telegram (в чате группы или, у встречи вдвоём, в личке друга)
 * перерисовывается, чтобы голоса не расходились. На «предложить изменения»
 * организатор получает уведомление — иначе предложение так и осталось бы
 * незамеченным. `chat` = null — встреча вдвоём.
 */
export async function notifyVote(
  chat: Chat | null,
  meeting: Meeting,
  voter: User,
  answer: string,
  comment: string,
): Promise<void> {
  await repo.markMeetingNoticesRead(meeting.id, voter.userId);
  await refreshCard(meeting);

  if (voter.userId === meeting.initiatorId) return;
  if (answer === "change") await notifyChangeProposal(chat, meeting, voter, comment);
  else if (answer === "yes" || answer === "maybe" || answer === "no") {
    await notifyOrganizerAnswer(chat, meeting, voter, answer);
  }
}

/**
 * Обратная связь организатору: кто ответил «да» или «нет» и сколько уже
 * согласились. Только личным сообщением — баннеров на сайте на каждый голос
 * не создаём, там и так видна карточка встречи. У встречи вдвоём (`chat` =
 * null) счёт «из скольких» не нужен — там сразу видно, когда встреча.
 */
export async function notifyOrganizerAnswer(
  chat: Chat | null,
  meeting: Meeting,
  voter: Pick<User, "userId" | "fullName" | "username" | "realName">,
  answer: "yes" | "maybe" | "no",
): Promise<boolean> {
  if (voter.userId === meeting.initiatorId) return false;
  // Группа, чей чат уже удалён, — писать не о чем.
  if (!chat && meeting.withUser === null) return false;
  const initiator = await repo.getUser(meeting.initiatorId);
  if (!initiator) return false;

  const lang = initiator.lang || chat?.lang || "ru";
  const goal = escapeHtml(meeting.goal || whenTextFor(meeting, lang) || "—");
  const name = escapeHtml(displayName(voter));
  let text: string;
  if (chat) {
    const responses = await repo.meetingResponsesFor(meeting.id);
    const key =
      answer === "yes" ? "notify_answer_yes" : answer === "maybe" ? "notify_answer_maybe" : "notify_answer_no";
    text = t(lang, key, {
      name,
      goal,
      yes: responses.filter((row) => row.answer === "yes").length,
      total: repo.inviteeIds(meeting).length,
    });
  } else {
    const key = answer === "yes" ? "notify_pair_yes" : answer === "maybe" ? "notify_pair_maybe" : "notify_pair_no";
    text = t(lang, key, { name, goal, when: escapeHtml(whenTextFor(meeting, lang)) });
  }
  return directMessage(initiator, text, markupOf(meetingButton(chat, meeting, initiator.userId, lang)));
}

export async function notifyChangeProposal(
  chat: Chat | null,
  meeting: Meeting,
  voter: Pick<User, "userId" | "fullName" | "username">,
  comment: string,
): Promise<void> {
  const initiator = await repo.getUser(meeting.initiatorId);
  if (!initiator || initiator.userId === voter.userId) return;

  const lang = chat?.lang ?? (initiator.lang || "ru");
  const text = t(lang, "notify_change", {
    name: escapeHtml(displayName(voter)),
    goal: escapeHtml(meeting.goal || whenTextFor(meeting, lang) || "—"),
    comment: escapeHtml(comment || "—"),
  });
  if (await directMessage(initiator, text, markupOf(meetingButton(chat, meeting, initiator.userId, lang)))) return;
  // Встреча вдвоём: баннеры живут в группах — предложение и так видно в карточке друга.
  if (!chat) return;

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
 * Пишем ему самому и создателю встречи; кого не достать ботом — баннером в
 * группе. У встречи вдвоём (`chat` = null) баннера нет: группы нет.
 */
export async function notifyConflict(chat: Chat | null, meeting: Meeting, user: User, when: string): Promise<void> {
  const lang = chat?.lang ?? (user.lang || "ru");
  const goal = escapeHtml(meeting.goal || whenTextFor(meeting, lang) || "—");

  const self = t(lang, "notify_conflict_self", { goal, when: escapeHtml(when) });
  if (!(await directMessage(user, self, markupOf(meetingButton(chat, meeting, user.userId, lang)))) && chat) {
    await repo.addNotices([
      { chatId: chat.chatId, userId: user.userId, kind: "conflict", meetingId: meeting.id, text: meeting.goal },
    ]);
  }

  if (meeting.initiatorId === user.userId) return;
  const initiator = await repo.getUser(meeting.initiatorId);
  if (!initiator) return;
  const other = t(chat?.lang ?? (initiator.lang || "ru"), "notify_conflict_other", {
    name: escapeHtml(displayName(user)),
    goal,
    when: escapeHtml(when),
  });
  if (await directMessage(initiator, other, markupOf(meetingButton(chat, meeting, initiator.userId, lang)))) return;
  if (!chat) return;
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

/**
 * Напомнить приглашённым, которые ещё не ответили на встречу. Встреча вдвоём
 * (`chat` = null): другу — та же карточка с кнопками; не достать ботом —
 * приглашение и так ждёт его в «Друзьях».
 */
export async function notifyNonResponders(
  chat: Chat | null,
  meeting: Meeting,
  from: User,
): Promise<Delivery> {
  const delivery: Delivery = { telegram: 0, site: 0 };
  const answered = new Set((await repo.meetingResponsesFor(meeting.id)).map((row) => row.userId));
  const waiting = repo.inviteeIds(meeting).filter((id) => !answered.has(id) && id !== from.userId);
  if (waiting.length === 0) return delivery;

  if (!chat) {
    for (const user of (await repo.usersByIds(waiting)).values()) {
      const lang = user.lang || "ru";
      const card = await renderCard(meeting.id, lang);
      const text = t(lang, "notify_pair_ping", { who: whoHtml(from) });
      if (await directMessage(user, `${text}\n\n${card.text}`, card.markup)) delivery.telegram += 1;
      else delivery.site += 1;
    }
    return delivery;
  }

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

/** «<b>Асель</b> (@asel_n)» — имя, которое человек указал, и ник, по которому его узнать. */
export function whoHtml(user: Pick<User, "fullName" | "username" | "userId" | "realName">): string {
  const name = `<b>${escapeHtml(displayName(user))}</b>`;
  return user.username ? `${name} (@${escapeHtml(user.username)})` : name;
}

/**
 * Встреча вдвоём: другу — карточка с теми же кнопками, что у встреч группы
 * («Приду / Не смогу / Может быть / Предложить другое», .ics) и кнопкой
 * «Открыть». Сообщение запоминается — его перерисуют ответы и отмена. Не
 * достать ботом — приглашение ждёт на сайте, в «Друзья → Заявки».
 */
export async function notifyPairMeetingCreated(meeting: Meeting, from: User, to: User): Promise<Delivery> {
  if (!reachableByBot(to)) return { telegram: 0, site: 1 };
  const lang = to.lang || "ru";
  const card = await renderCard(meeting.id, lang);
  try {
    const sent = await sendMessage({
      chat_id: to.userId,
      text: `${t(lang, "notify_pair_new", { who: whoHtml(from) })}\n\n${card.text}`,
      parse_mode: "HTML",
      reply_markup: card.markup,
      link_preview_options: { is_disabled: true },
    });
    await repo.updateMeeting(meeting.id, { chatMessageId: sent.message_id });
    return { telegram: 1, site: 0 };
  } catch (error) {
    if (!(error instanceof TelegramError)) console.error("notify: pair card", error);
    return { telegram: 0, site: 1 };
  }
}

/**
 * Встречу вдвоём отменили: карточка у друга перерисовывается на «отменена»,
 * и ему — короткое сообщение (тихую правку старого сообщения легко не заметить).
 */
export async function notifyPairCancelled(meeting: Meeting, by: User, to: User): Promise<boolean> {
  await refreshCard({ ...meeting, status: "cancelled" });
  const lang = to.lang || "ru";
  return directMessage(
    to,
    t(lang, "notify_pair_cancelled", {
      who: whoHtml(by),
      goal: escapeHtml(meeting.goal || "—"),
      when: escapeHtml(whenTextFor(meeting, lang)),
    }),
    markupOf(meetingButton(null, meeting, to.userId, lang)),
  );
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
