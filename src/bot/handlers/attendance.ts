/**
 * «Был ли ты на встрече?» — после конца встречи бот спрашивает тех, кто
 * собирался прийти («иду» или «может»), кнопками «Был» / «Не был». Ответ
 * идёт в статистику группы: у старосты в «Участниках» видно, кто доходит.
 *
 * Спрашивает cron (раз в 10 минут), один раз на повтор встречи: ключ в
 * bot_state ставится до отправки — лишний вопрос хуже пропущенного.
 */

import "server-only";

import { justEnded } from "@/core/attendance";
import { fmtMinutes } from "@/core/intervals";
import { escapeHtml } from "@/core/textutils";
import { addDays, chatTz, type DateStr, todayIn, utcToZonedWall } from "@/core/timeutils";
import * as repo from "@/db/repo";
import { formatDay, t } from "@/i18n";
import { meetingDurationMin } from "@/lib/group";
import { answerCallbackQuery, editMessageText, keyboard, sendMessage, type TgCallbackQuery } from "../api";

const KEY = "attend:";

/** Разослать вопрос о закончившихся встречах. Возвращает, скольким людям ушёл вопрос. */
export async function askAttendance(now = new Date()): Promise<number> {
  let asked = 0;
  const candidates = await repo.attendanceCandidates(now, addDays(todayIn("UTC", now), -1));
  for (const meeting of candidates) {
    const chat = await repo.getChat(meeting.chatId);
    if (!chat) continue;
    const tz = chatTz(chat);
    const ended = justEnded(meeting, meetingDurationMin(meeting, tz), tz, now);
    if (!ended) continue;
    const key = `${KEY}${meeting.id}:${ended.day}`;
    if (await repo.getBotState(key)) continue;
    await repo.setBotState(key, { at: now.toISOString() });

    const invitees = new Set(repo.inviteeIds(meeting));
    const going = (await repo.meetingResponsesFor(meeting.id))
      .filter((row) => (row.answer === "yes" || row.answer === "maybe") && invitees.has(row.userId))
      .map((row) => row.userId);
    if (going.length === 0) continue;
    const people = await repo.usersByIds(going);

    const wall = utcToZonedWall(ended.start, tz);
    for (const user of people.values()) {
      if (user.isWeb || user.userId <= 0) continue;
      const lang = user.lang || chat.lang;
      try {
        await sendMessage({
          chat_id: user.userId,
          text: t(lang, "attend_ask", {
            goal: escapeHtml(meeting.goal || meeting.place) || "—",
            when: `${formatDay(lang, wall.day)} · ${fmtMinutes(wall.minutes)}`,
            chat: escapeHtml(chat.title) || "—",
          }),
          parse_mode: "HTML",
          reply_markup: keyboard([
            [
              { text: t(lang, "attend_btn_yes"), callback_data: `att:${meeting.id}:${ended.day}:1` },
              { text: t(lang, "attend_btn_no"), callback_data: `att:${meeting.id}:${ended.day}:0` },
            ],
          ]),
        });
        asked += 1;
      } catch {
        // Человек не запускал бота или заблокировал его.
      }
    }
  }
  // Ключи старше трёх суток не нужны: о тех повторах уже не спрашивают.
  await repo.deleteStaleBotState(KEY, new Date(now.getTime() - 3 * 86_400_000));
  return asked;
}

/** Кнопка «Был» / «Не был» под вопросом. */
export async function onAttendanceButton(query: TgCallbackQuery): Promise<void> {
  const match = /^att:(\d+):(\d{4}-\d{2}-\d{2}):([01])$/.exec(query.data ?? "");
  const meeting = match ? await repo.getMeeting(Number(match[1])) : null;
  if (!match || !meeting) {
    await answerCallbackQuery({ callback_query_id: query.id });
    return;
  }
  const chat = await repo.getChat(meeting.chatId);
  const lang = chat?.lang ?? "ru";
  if (!repo.inviteeIds(meeting).includes(query.from.id)) {
    await answerCallbackQuery({ callback_query_id: query.id, text: t(lang, "vote_not_invited"), show_alert: true });
    return;
  }

  const attended = match[3] === "1";
  await repo.setAttendance({
    meetingId: meeting.id,
    occurrence: match[2] as DateStr,
    userId: query.from.id,
    attended,
  });
  const goal = escapeHtml(meeting.goal || meeting.place) || "—";
  await answerCallbackQuery({ callback_query_id: query.id, text: t(lang, "attend_thanks") });
  if (query.message) {
    await editMessageText({
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      text: t(lang, attended ? "attend_saved_yes" : "attend_saved_no", { goal }),
      parse_mode: "HTML",
    });
  }
}
