/**
 * «Был ли ты на встрече»: какой повтор встречи только что закончился (о нём
 * бот спрашивает) и какой закончился последним (его отмечают на сайте).
 * Чистые функции — проверяются тестами без базы и бота.
 */

import { occurrencesBetween } from "./recurrence";
import { type DateStr, utcToZonedWall } from "./timeutils";

/** Сколько после конца встречи бот ещё спрашивает «был ли ты». Дальше — только сайт. */
export const ASK_WINDOW_MS = 12 * 60 * 60 * 1000;
/** Дальше этого в прошлое повторы не ищем: отмечать давнюю встречу незачем. */
const LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

export type AttendanceTiming = {
  whenStart: Date | null;
  repeatUntil: DateStr | null;
};

/** Повторы, закончившиеся в [from, now]: начало и день в поясе группы. */
function endedBetween(
  meeting: AttendanceTiming,
  durationMin: number,
  tz: string,
  from: Date,
  now: Date,
): { start: Date; day: DateStr }[] {
  if (!meeting.whenStart) return [];
  const duration = durationMin * 60_000;
  return occurrencesBetween(meeting.whenStart, meeting.repeatUntil, tz, new Date(from.getTime() - duration), now)
    .filter((start) => {
      const end = start.getTime() + duration;
      return end <= now.getTime() && end > from.getTime();
    })
    .map((start) => ({ start, day: utcToZonedWall(start, tz).day }));
}

/**
 * Повтор, который закончился за последние `window` мс: о нём спрашивает бот.
 * null — такого нет (встреча ещё идёт, не началась или кончилась давно).
 */
export function justEnded(
  meeting: AttendanceTiming,
  durationMin: number,
  tz: string,
  now: Date,
  window = ASK_WINDOW_MS,
): { start: Date; day: DateStr } | null {
  return endedBetween(meeting, durationMin, tz, new Date(now.getTime() - window), now).at(-1) ?? null;
}

/** Последний закончившийся повтор (за месяц): его отмечают на сайте у прошедшей встречи. */
export function lastEnded(meeting: AttendanceTiming, durationMin: number, tz: string, now: Date): DateStr | null {
  return endedBetween(meeting, durationMin, tz, new Date(now.getTime() - LOOKBACK_MS), now).at(-1)?.day ?? null;
}
