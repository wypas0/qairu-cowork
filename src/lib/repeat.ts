import { fmtMinutes } from "@/core/intervals";
import { addDays, zonedWallToUtc } from "@/core/timeutils";
import type { Meeting } from "@/db/schema";
import { formatDay } from "@/i18n";
import type { PickDetail } from "@/components/pick";
import { meetingSpan } from "./group";

/**
 * «Повторить встречу»: то же время в тот же день недели — ближайший, который
 * ещё не прошёл. Встреча без точного времени повторяется своим текстом.
 */
export function repeatDetail(meeting: Meeting, tz: string, lang: string, now: Date): PickDetail {
  const base = { goal: meeting.goal, place: meeting.place };
  const span = meetingSpan(meeting, tz);
  if (!span) return { ...base, value: meeting.whenText, text: meeting.whenText };
  let day = span.date;
  do day = addDays(day, 7);
  while (zonedWallToUtc(day, span.start, tz) <= now);
  return {
    ...base,
    value: `${day}T${fmtMinutes(span.start)}|${span.end - span.start}`,
    text: `${formatDay(lang, day)} · ${fmtMinutes(span.start)}–${fmtMinutes(span.end)}`,
  };
}
