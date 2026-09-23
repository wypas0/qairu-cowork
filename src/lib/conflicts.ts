/**
 * Конфликт: человек ответил «иду» (или «может»), а потом поменял расписание
 * так, что встреча легла на занятое время. Предупреждаем его самого — вдруг
 * не заметил — и создателя встречи: ему важно знать, что кто-то отпадает.
 *
 * Проверка запускается после любого изменения занятости: сетка, разовая
 * занятость, календарь по ссылке. Об одном и том же повторе встречи
 * предупреждаем один раз.
 */

import "server-only";

import { fmtMinutes } from "@/core/intervals";
import { occurrencesBetween } from "@/core/recurrence";
import { chatTz } from "@/core/timeutils";
import * as repo from "@/db/repo";
import { formatDay } from "@/i18n";
import { meetingSpan, parityOfChat } from "./group";
import { notifyConflict } from "./notify";

/** Насколько вперёд смотрим — как далеко листается карта группы. */
const HORIZON_MS = 8 * 7 * 24 * 60 * 60 * 1000;

/** Проверить встречи человека; вернуть, о скольких предупредили. */
export async function checkConflicts(userId: number, now: Date = new Date()): Promise<number> {
  const user = await repo.getUser(userId);
  if (!user) return 0;
  const chats = await repo.userChats(userId);
  if (chats.length === 0) return 0;

  const meetings = (await repo.feedMeetings(chats.map((chat) => chat.chatId), now)).filter((meeting) =>
    repo.inviteeIds(meeting).includes(userId),
  );
  if (meetings.length === 0) return 0;

  const answers = await repo.meetingResponsesForMany(meetings.map((meeting) => meeting.id));
  const [person] = await repo.buildPersonSchedules([user]);
  const horizon = new Date(now.getTime() + HORIZON_MS);
  let warned = 0;

  for (const meeting of meetings) {
    const answer = answers.get(meeting.id)?.find((row) => row.userId === userId)?.answer;
    if (answer !== "yes" && answer !== "maybe") continue;
    const chat = chats.find((entry) => entry.chatId === meeting.chatId);
    if (!chat || !meeting.whenStart) continue;
    const tz = chatTz(chat);
    const parityOf = parityOfChat(chat);

    for (const start of occurrencesBetween(meeting.whenStart, meeting.repeatUntil, tz, now, horizon)) {
      const span = meetingSpan({ ...meeting, whenStart: start }, tz);
      if (!span) continue;
      const busy = person.busyOn(span.date, parityOf ? parityOf(span.date) : null);
      if (!busy.some(([from, to]) => from < span.end && span.start < to)) continue;

      // Об этом повторе уже предупреждали — второй раз не пишем.
      const key = `conflict:${meeting.id}:${userId}:${start.getTime()}`;
      if (await repo.getBotState(key)) break;
      await repo.setBotState(key, { at: now.getTime() });

      const when = `${formatDay(chat.lang, span.date)} · ${fmtMinutes(span.start)}–${fmtMinutes(span.end)}`;
      await notifyConflict(chat, meeting, user, when);
      warned += 1;
      break; // одного предупреждения на встречу достаточно
    }
  }
  return warned;
}

/** То же, но без исключений наружу: вызывается после ответа браузеру. */
export async function checkConflictsQuietly(userId: number): Promise<void> {
  try {
    await checkConflicts(userId);
  } catch (error) {
    console.error("conflicts: check failed", error);
  }
}
