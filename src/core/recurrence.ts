/**
 * Повторяющиеся встречи: «каждую неделю в тот же день и час до такой-то даты».
 *
 * Хранится только первая встреча и дата окончания серии, отдельные повторы
 * вычисляются здесь. Шаг — ровно неделя по стенным часам группы: встреча
 * в среду в 15:00 остаётся в среду в 15:00, даже если между повторами
 * часы переводили.
 */

import { type DateStr, addDays, utcToZonedWall, zonedWallToUtc } from "./timeutils";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** Больше повторов за один запрос не бывает: год — это 53 недели. */
const MAX_OCCURRENCES = 60;

/** Повторы серии, начинающиеся в промежутке [from, to). Для разовой встречи — она сама, если попала. */
export function occurrencesBetween(
  first: Date,
  repeatUntil: DateStr | null,
  tz: string,
  from: Date,
  to: Date,
): Date[] {
  if (!repeatUntil) return first >= from && first < to ? [first] : [];
  const { day, minutes } = utcToZonedWall(first, tz);
  // Перескакиваем сразу к неделе рядом с `from`; на неделю раньше — с запасом
  // на перевод часов, лишнее отсечёт проверка ниже.
  const skip = Math.max(0, Math.floor((from.getTime() - first.getTime()) / WEEK_MS) - 1);
  const result: Date[] = [];
  for (let week = skip; result.length < MAX_OCCURRENCES; week += 1) {
    const date = addDays(day, week * 7);
    if (date > repeatUntil) break;
    const start = zonedWallToUtc(date, minutes, tz);
    if (start >= to) break;
    if (start >= from) result.push(start);
  }
  return result;
}

/** Ближайший повтор, который ещё не начался, или null, если серия закончилась. */
export function nextOccurrence(
  first: Date,
  repeatUntil: DateStr | null,
  tz: string,
  now: Date,
): Date | null {
  const horizon = repeatUntil
    ? zonedWallToUtc(addDays(repeatUntil, 1), 0, tz)
    : new Date(first.getTime() + 1);
  const upcoming = occurrencesBetween(first, repeatUntil, tz, now, horizon);
  return upcoming.find((start) => start > now) ?? null;
}

/** Серия закончилась: последняя дата повтора уже прошла. */
export function seriesOver(repeatUntil: DateStr, today: DateStr): boolean {
  return repeatUntil < today;
}

/** RRULE для календарей: каждую неделю до конца дня `repeatUntil` в поясе группы. */
export function weeklyRule(repeatUntil: DateStr, tz: string): string {
  const until = zonedWallToUtc(repeatUntil, 23 * 60 + 59, tz)
    .toISOString()
    .replace(/[-:]|\.\d{3}/g, "");
  return `FREQ=WEEKLY;UNTIL=${until}`;
}

/** Встреча в том виде, которого хватает, чтобы найти её ближайший повтор. */
export type TimedMeeting = {
  id: number;
  chatId: number;
  whenStart: Date | null;
  repeatUntil: DateStr | null;
};

/**
 * Все ещё не начавшиеся встречи каждой группы, по времени, — для списка под
 * группой в сайдбаре. Для серии берётся ближайший повтор, а не первая дата:
 * серия, начавшаяся месяц назад, всё ещё «встреча в среду».
 */
export function upcomingByChat<M extends TimedMeeting>(
  meetings: M[],
  tzOf: (chatId: number) => string,
  now: Date,
): Map<number, { meeting: M; start: Date }[]> {
  const result = new Map<number, { meeting: M; start: Date }[]>();
  for (const meeting of meetings) {
    if (!meeting.whenStart) continue;
    const start = meeting.repeatUntil
      ? nextOccurrence(meeting.whenStart, meeting.repeatUntil, tzOf(meeting.chatId), now)
      : meeting.whenStart > now
        ? meeting.whenStart
        : null;
    if (!start) continue;
    const list = result.get(meeting.chatId) ?? [];
    list.push({ meeting, start });
    result.set(meeting.chatId, list);
  }
  for (const list of result.values()) list.sort((a, b) => a.start.getTime() - b.start.getTime());
  return result;
}
