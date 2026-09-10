/** Команда /meeting — создание встречи с опросом в чате. */

import "server-only";

import { computeAvailability, parityFromSemesterStart, topSlots } from "@/core/availability";
import { buildIcs } from "@/core/calendar";
import { fmtInterval } from "@/core/intervals";
import { escapeHtml } from "@/core/textutils";
import { type DateStr, chatTz, todayIn, zonedWallToUtc } from "@/core/timeutils";
import * as repo from "@/db/repo";
import type { User } from "@/db/schema";
import { formatDay, t } from "@/i18n";
import {
  FORCE_REPLY,
  answerCallbackQuery,
  editMessageReplyMarkup,
  editMessageText,
  isGroup,
  keyboard,
  sendDocument,
  sendMessage,
  type InlineKeyboardMarkup,
  type TgCallbackQuery,
  type TgMessage,
} from "../api";
import { extractMentionedUsers, mentionList, syncUser } from "../context";

type TimeOption = { label: string; date: DateStr; start: number; end: number };

type MeetingDraft = {
  chatId: number;
  userId: number;
  lang: string;
  invitees: number[];
  step: "place" | "time" | "goal";
  promptId: number;
  place?: string;
  when?: string;
  whenDate?: DateStr;
  whenStartMin?: number;
  options?: TimeOption[];
  at: number;
};

const DRAFT_TTL_MS = 15 * 60 * 1000;

function draftKey(chatId: number, userId: number): string {
  return `mtg:${chatId}:${userId}`;
}

function promptKey(chatId: number, messageId: number): string {
  return `mtgprompt:${chatId}:${messageId}`;
}

function changeKey(chatId: number, messageId: number): string {
  return `chg:${chatId}:${messageId}`;
}

async function saveDraft(draft: MeetingDraft): Promise<void> {
  await repo.setBotState(draftKey(draft.chatId, draft.userId), draft);
  await repo.setBotState(promptKey(draft.chatId, draft.promptId), { userId: draft.userId });
}

async function dropDraft(chatId: number, userId: number): Promise<void> {
  await repo.deleteBotState(draftKey(chatId, userId));
}

function dedup(ids: number[]): number[] {
  return [...new Set(ids)];
}

// --------------------------------------------------------------------------
// Мастер создания встречи
// --------------------------------------------------------------------------

export async function cmdMeeting(message: TgMessage): Promise<void> {
  const from = message.from;
  if (!from) return;

  if (!isGroup(message.chat)) {
    const chat = await repo.getChat(message.chat.id);
    await sendMessage({ chat_id: message.chat.id, text: t(chat?.lang ?? "ru", "only_group") });
    return;
  }

  const chat = await repo.upsertChat(message.chat.id, message.chat.title ?? "");
  const lang = chat.lang;
  await syncUser(from);
  await repo.addMembership(message.chat.id, from.id);

  const { found: mentioned } = await extractMentionedUsers(message);
  const invitees = mentioned.length
    ? dedup([from.id, ...mentioned.map((user) => user.userId)])
    : (await repo.chatMembers(message.chat.id)).map((member) => member.userId);

  if (invitees.length === 0) {
    await sendMessage({ chat_id: message.chat.id, text: t(lang, "avail_no_members") });
    return;
  }

  const prompt = await sendMessage({
    chat_id: message.chat.id,
    text: t(lang, "meeting_step1"),
    parse_mode: "HTML",
    reply_markup: FORCE_REPLY,
  });

  await saveDraft({
    chatId: message.chat.id,
    userId: from.id,
    lang,
    invitees,
    step: "place",
    promptId: prompt.message_id,
    at: Date.now(),
  });
}

/** Кнопки с топ-5 общих окон приглашённых + ручной ввод. */
async function timeKeyboard(
  draft: MeetingDraft,
): Promise<{ options: TimeOption[]; markup: InlineKeyboardMarkup | null }> {
  const chat = await repo.getChat(draft.chatId);
  if (!chat) return { options: [], markup: null };

  const byId = await repo.usersByIds(draft.invitees);
  const people = await repo.buildPersonSchedules([...byId.values()]);
  if (!people.some((person) => person.hasData)) return { options: [], markup: null };

  const result = computeAvailability(people, todayIn(chatTz(chat)), {
    daysAhead: 7,
    dayStart: chat.dayStartMin,
    dayEnd: chat.dayEndMin,
    minSlot: chat.minSlotMin,
    parityOf: chat.semesterStart ? parityFromSemesterStart(chat.semesterStart) : null,
    bufferMin: chat.travelBufferMin,
  });

  const slots = topSlots(result, 5);
  if (slots.length === 0) return { options: [], markup: null };

  const options: TimeOption[] = slots.map((slot) => ({
    label: `${formatDay(draft.lang, slot.day)} · ${fmtInterval(slot.interval)}`,
    date: slot.day,
    start: slot.interval[0],
    end: slot.interval[1],
  }));

  const rows = options.map((option, index) => [
    { text: option.label, callback_data: `mtg:slot:${index}` },
  ]);
  rows.push([{ text: t(draft.lang, "btn_manual_time"), callback_data: "mtg:manual" }]);
  return { options, markup: keyboard(rows) };
}

/** Ответ организатора на ForceReply-подсказку. Возвращает true, если сообщение съедено. */
export async function onDraftReply(message: TgMessage): Promise<boolean> {
  const from = message.from;
  const replyTo = message.reply_to_message;
  if (!from || !replyTo) return false;

  const owner = await repo.getBotState<{ userId: number }>(
    promptKey(message.chat.id, replyTo.message_id),
  );
  if (!owner || owner.userId !== from.id) return false;

  const draft = await repo.getBotState<MeetingDraft>(draftKey(message.chat.id, from.id));
  await repo.deleteBotState(promptKey(message.chat.id, replyTo.message_id));
  if (!draft) return false;
  if (Date.now() - draft.at > DRAFT_TTL_MS) {
    await dropDraft(message.chat.id, from.id);
    await sendMessage({ chat_id: message.chat.id, text: t(draft.lang, "meeting_timeout") });
    return true;
  }

  const text = (message.text ?? "").trim();

  if (draft.step === "place") {
    draft.place = text.slice(0, 200);
    const { options, markup } = await timeKeyboard(draft);
    const prompt = markup
      ? await sendMessage({
          chat_id: draft.chatId,
          text: t(draft.lang, "meeting_step2"),
          parse_mode: "HTML",
          reply_markup: markup,
        })
      : await sendMessage({
          chat_id: draft.chatId,
          text: `${t(draft.lang, "meeting_no_windows")}\n\n${t(draft.lang, "meeting_step2_manual")}`,
          parse_mode: "HTML",
          reply_markup: FORCE_REPLY,
        });
    draft.options = options;
    draft.step = "time";
    draft.promptId = prompt.message_id;
    await saveDraft(draft);
    return true;
  }

  if (draft.step === "time") {
    draft.when = text.slice(0, 200);
    const prompt = await sendMessage({
      chat_id: draft.chatId,
      text: t(draft.lang, "meeting_step3"),
      parse_mode: "HTML",
      reply_markup: FORCE_REPLY,
    });
    draft.step = "goal";
    draft.promptId = prompt.message_id;
    await saveDraft(draft);
    return true;
  }

  // step === "goal"
  await finishMeeting(draft, text.slice(0, 500));
  return true;
}

export async function onTimeButton(query: TgCallbackQuery): Promise<void> {
  const message = query.message;
  if (!message) return;

  const draft = await repo.getBotState<MeetingDraft>(draftKey(message.chat.id, query.from.id));
  if (!draft) {
    // Кнопки видит весь чат, но мастер принадлежит одному человеку.
    const chat = await repo.getChat(message.chat.id);
    await answerCallbackQuery({
      callback_query_id: query.id,
      text: t(chat?.lang ?? "ru", "meeting_not_yours"),
      show_alert: true,
    });
    return;
  }

  await answerCallbackQuery({ callback_query_id: query.id });

  if (query.data === "mtg:manual") {
    await editMessageReplyMarkup({
      chat_id: message.chat.id,
      message_id: message.message_id,
    });
    const prompt = await sendMessage({
      chat_id: draft.chatId,
      text: t(draft.lang, "meeting_step2_manual"),
      parse_mode: "HTML",
      reply_markup: FORCE_REPLY,
    });
    draft.step = "time";
    draft.promptId = prompt.message_id;
    await saveDraft(draft);
    return;
  }

  const index = Number((query.data ?? "").split(":").pop());
  const options = draft.options ?? [];
  if (!Number.isInteger(index) || index >= options.length) return;
  const chosen = options[index];

  draft.when = chosen.label;
  draft.whenDate = chosen.date;
  draft.whenStartMin = chosen.start;

  await editMessageText({
    chat_id: message.chat.id,
    message_id: message.message_id,
    text: `🕒 ${escapeHtml(chosen.label)}`,
    parse_mode: "HTML",
  });
  const prompt = await sendMessage({
    chat_id: draft.chatId,
    text: t(draft.lang, "meeting_step3"),
    parse_mode: "HTML",
    reply_markup: FORCE_REPLY,
  });
  draft.step = "goal";
  draft.promptId = prompt.message_id;
  await saveDraft(draft);
}

async function finishMeeting(draft: MeetingDraft, goal: string): Promise<void> {
  const chat = await repo.getChat(draft.chatId);
  // Точное время начала известно, только если организатор выбрал окно кнопкой:
  // разбирать произвольную фразу в дату — значит поставить напоминание не туда.
  const whenStart =
    chat && draft.whenDate && draft.whenStartMin !== undefined
      ? zonedWallToUtc(draft.whenDate, draft.whenStartMin, chatTz(chat))
      : null;

  const meeting = await repo.createMeeting({
    chatId: draft.chatId,
    initiatorId: draft.userId,
    place: draft.place ?? "",
    whenText: draft.when ?? "",
    goal,
    invitees: draft.invitees,
    whenStart,
  });

  const card = await renderCard(meeting.id, draft.lang);
  const sent = await sendMessage({
    chat_id: draft.chatId,
    text: card.text,
    parse_mode: "HTML",
    reply_markup: card.markup,
    link_preview_options: { is_disabled: true },
  });

  await repo.updateMeeting(meeting.id, { chatMessageId: sent.message_id });
  await dropDraft(draft.chatId, draft.userId);
}

// --------------------------------------------------------------------------
// Карточка встречи и голосование
// --------------------------------------------------------------------------

async function renderCard(
  meetingId: number,
  lang: string,
): Promise<{ text: string; markup: InlineKeyboardMarkup }> {
  const meeting = await repo.getMeeting(meetingId);
  if (!meeting) return { text: t(lang, "error_generic"), markup: keyboard([]) };

  const inviteeIds = repo.inviteeIds(meeting);
  const byId = await repo.usersByIds(inviteeIds);
  const responses = await repo.meetingResponsesFor(meetingId);
  const ordered = inviteeIds
    .filter((id) => byId.has(id))
    .map((id) => byId.get(id)!);

  const place = escapeHtml(meeting.place) || "—";
  const when = escapeHtml(meeting.whenText) || "—";
  const goal = escapeHtml(meeting.goal) || "—";

  if (meeting.status === "cancelled") {
    return {
      text: t(lang, "meeting_cancelled_card", { place, when, goal }),
      markup: keyboard([]),
    };
  }

  let text = t(lang, "meeting_card", { place, when, goal, invitees: mentionList(ordered) });

  const buckets: Record<string, User[]> = { yes: [], no: [], change: [] };
  const comments: string[] = [];
  for (const response of responses) {
    const user = byId.get(response.userId);
    if (user && response.answer in buckets) buckets[response.answer].push(user);
    if (response.comment && user) {
      comments.push(`• ${escapeHtml(user.fullName || String(user.userId))}: ${escapeHtml(response.comment)}`);
    }
  }

  text += t(lang, "meeting_votes", {
    yes: buckets.yes.length,
    yes_names: mentionList(buckets.yes),
    no: buckets.no.length,
    no_names: mentionList(buckets.no),
    change: buckets.change.length,
    change_names: mentionList(buckets.change),
  });
  if (comments.length) {
    text += t(lang, "changes_block", { items: comments.slice(0, 10).join("\n") });
  }

  const rows = [
    [
      { text: `${t(lang, "btn_yes")} ${buckets.yes.length}`, callback_data: `vote:${meetingId}:yes` },
      {
        text: `${t(lang, "btn_no_answer")} ${buckets.no.length}`,
        callback_data: `vote:${meetingId}:no`,
      },
    ],
    [{ text: t(lang, "btn_change"), callback_data: `vote:${meetingId}:change` }],
  ];
  const extra = [];
  if (meeting.whenStart) {
    extra.push({ text: t(lang, "btn_ics"), callback_data: `card:ics:${meetingId}` });
  }
  extra.push({ text: t(lang, "btn_cancel_meeting"), callback_data: `card:cancel:${meetingId}` });
  rows.push(extra);

  return { text, markup: keyboard(rows) };
}

export async function onVote(query: TgCallbackQuery): Promise<void> {
  const message = query.message;
  if (!message || !query.data) return;
  const [, rawId, answer] = query.data.split(":");
  const meetingId = Number(rawId);

  const meeting = await repo.getMeeting(meetingId);
  if (!meeting) {
    await answerCallbackQuery({ callback_query_id: query.id });
    return;
  }
  const chat = await repo.getChat(meeting.chatId);
  const lang = chat?.lang ?? "ru";

  if (!repo.inviteeIds(meeting).includes(query.from.id)) {
    await answerCallbackQuery({
      callback_query_id: query.id,
      text: t(lang, "vote_not_invited"),
      show_alert: true,
    });
    return;
  }

  await syncUser(query.from);
  await repo.setResponse({ meetingId, userId: query.from.id, answer });

  await answerCallbackQuery({
    callback_query_id: query.id,
    text: t(lang, "vote_registered", { answer: t(lang, `answer_${answer}`) }),
  });

  const card = await renderCard(meetingId, lang);
  await editMessageText({
    chat_id: message.chat.id,
    message_id: message.message_id,
    text: card.text,
    parse_mode: "HTML",
    reply_markup: card.markup,
    link_preview_options: { is_disabled: true },
  });

  if (answer === "change") {
    const name = escapeHtml(
      [query.from.first_name, query.from.last_name].filter(Boolean).join(" ") || "",
    );
    const prompt = await sendMessage({
      chat_id: meeting.chatId,
      text: `<a href="tg://user?id=${query.from.id}">${name}</a>, ${t(lang, "change_ask")}`,
      parse_mode: "HTML",
      reply_markup: FORCE_REPLY,
    });
    await repo.setBotState(changeKey(meeting.chatId, prompt.message_id), {
      meetingId,
      userId: query.from.id,
    });
  }
}

/** Кнопки карточки: выгрузить .ics и отменить встречу. */
export async function onCardButton(query: TgCallbackQuery): Promise<void> {
  const message = query.message;
  if (!message || !query.data) return;
  const [, action, rawId] = query.data.split(":");
  const meetingId = Number(rawId);

  const meeting = await repo.getMeeting(meetingId);
  if (!meeting) {
    await answerCallbackQuery({ callback_query_id: query.id });
    return;
  }
  const chat = await repo.getChat(meeting.chatId);
  const lang = chat?.lang ?? "ru";

  if (action === "cancel") {
    if (query.from.id !== meeting.initiatorId) {
      await answerCallbackQuery({
        callback_query_id: query.id,
        text: t(lang, "cancel_only_initiator"),
        show_alert: true,
      });
      return;
    }
    await repo.updateMeeting(meetingId, { status: "cancelled" });
    await answerCallbackQuery({
      callback_query_id: query.id,
      text: t(lang, "meeting_cancel_done"),
    });
    const card = await renderCard(meetingId, lang);
    await editMessageText({
      chat_id: message.chat.id,
      message_id: message.message_id,
      text: card.text,
      parse_mode: "HTML",
      reply_markup: card.markup,
      link_preview_options: { is_disabled: true },
    });
    return;
  }

  await answerCallbackQuery({ callback_query_id: query.id });
  if (!meeting.whenStart) return;

  await sendDocument({
    chat_id: meeting.chatId,
    filename: `qairu-meeting-${meetingId}.ics`,
    mime: "text/calendar",
    content: buildIcs({
      uid: `meeting-${meetingId}`,
      summary: meeting.goal || t(lang, "ics_default_summary"),
      start: meeting.whenStart,
      durationMin: 90,
      location: meeting.place,
      description: meeting.goal,
    }),
    caption: t(lang, "ics_caption"),
  });
}

/** Ответ на «предложить изменения» — дописываем комментарий в карточку. */
export async function onChangeReply(message: TgMessage): Promise<boolean> {
  const from = message.from;
  const replyTo = message.reply_to_message;
  if (!from || !replyTo) return false;

  const key = changeKey(message.chat.id, replyTo.message_id);
  const entry = await repo.getBotState<{ meetingId: number; userId: number }>(key);
  if (!entry) return false;
  if (entry.userId !== from.id) return false;

  const meeting = await repo.getMeeting(entry.meetingId);
  await repo.deleteBotState(key);
  if (!meeting) return true;

  const chat = await repo.getChat(meeting.chatId);
  const lang = chat?.lang ?? "ru";
  await repo.setResponse({
    meetingId: entry.meetingId,
    userId: from.id,
    answer: "change",
    comment: (message.text ?? "").trim().slice(0, 300),
  });

  if (meeting.chatMessageId) {
    const card = await renderCard(entry.meetingId, lang);
    await editMessageText({
      chat_id: meeting.chatId,
      message_id: meeting.chatMessageId,
      text: card.text,
      parse_mode: "HTML",
      reply_markup: card.markup,
      link_preview_options: { is_disabled: true },
    });
  }

  await sendMessage({ chat_id: message.chat.id, text: t(lang, "change_saved") });
  return true;
}

// --------------------------------------------------------------------------
// Напоминания
// --------------------------------------------------------------------------

/**
 * Разослать напоминания о встречах, до которых осталось меньше reminder_min.
 *
 * У python-telegram-bot это делала JobQueue внутри живого процесса. На Vercel
 * процесса нет, поэтому задачу выполняет cron, а флаг `reminder_sent` не даёт
 * отправить одно и то же напоминание дважды.
 */
export async function sendDueReminders(now = new Date()): Promise<number> {
  const due = await repo.meetingsDueForReminder(now);
  let sent = 0;

  for (const { meeting, chat } of due) {
    const responses = await repo.meetingResponsesFor(meeting.id);
    const saidYes = responses.filter((row) => row.answer === "yes").map((row) => row.userId);
    const targetIds = saidYes.length ? saidYes : repo.inviteeIds(meeting);
    const byId = await repo.usersByIds(targetIds);
    const ordered = targetIds.filter((id) => byId.has(id)).map((id) => byId.get(id)!);

    // Флаг ставим до отправки: повторное напоминание хуже пропущенного.
    await repo.updateMeeting(meeting.id, { reminderSent: true });
    try {
      await sendMessage({
        chat_id: meeting.chatId,
        text: t(chat.lang, "meeting_reminder", {
          minutes: chat.reminderMin,
          place: escapeHtml(meeting.place) || "—",
          goal: escapeHtml(meeting.goal) || "—",
          names: mentionList(ordered),
        }),
        parse_mode: "HTML",
      });
      sent += 1;
    } catch {
      // Чат мог быть удалён или бота выгнали — молча пропускаем.
    }
  }
  return sent;
}
