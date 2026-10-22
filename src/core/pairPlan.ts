/**
 * Встреча вдвоём с другом: как из общих окон получаются кнопки выбора.
 * Чистые функции без базы — их зовёт и карточка друга, и сервер, который
 * проверяет, что пришло из формы.
 *
 * Выбор — не текстом: длительность кнопками, день строкой, начало кнопкой.
 * Кнопки начала — само начало окна (пара кончилась в 10:50 — значит 10:50),
 * дальше ровные :00 и :30, пока встреча влезает в окно.
 */

import { type Interval, intersect, invert, merge } from "./intervals";
import { type DateStr, addDays, isDateStr } from "./timeutils";

export const PAIR_PLAN = {
  /** Две недели вперёд: «эта» и «следующая», по семь дней. */
  daysAhead: 14,
  dayStart: 8 * 60,
  dayEnd: 22 * 60,
  /** Шаг кнопок начала. */
  step: 30,
  durations: [30, 60, 90, 120] as const,
  defaultDuration: 60,
  /** Сколько готовых вариантов показать сверху. */
  suggestions: 3,
  /** За сколько минут бот напоминает обоим — как у группы по умолчанию. */
  reminderMin: 30,
} as const;

/** Второй человек встречи вдвоём для `me`: создателю — друг, другу — создатель. */
export function pairPartner(meeting: { initiatorId: number; withUser: number | null }, me: number): number | null {
  if (meeting.withUser === null) return null;
  return me === meeting.initiatorId ? meeting.withUser : meeting.initiatorId;
}

export type PlanDay = {
  day: DateStr;
  /** Когда оба свободны; null — неизвестно (расписание скрыто или не заполнено). */
  windows: Interval[] | null;
};

/** Ровное время не раньше `minutes`: 10:50 → 11:00 при шаге 30. */
function ceilTo(minutes: number, step: number): number {
  return Math.ceil(minutes / step) * step;
}

/**
 * Кнопки начала встречи длиной `duration` внутри окон — по возрастанию, без
 * повторов. Окно 10:50–13:00 и час: 10:50, 11:00, 11:30, 12:00.
 */
export function startOptions(windows: readonly Interval[], duration: number, step: number = PAIR_PLAN.step): number[] {
  const starts = new Set<number>();
  for (const [from, to] of windows) {
    if (to - from < duration) continue;
    starts.add(from);
    for (let start = ceilTo(from, step); start + duration <= to; start += step) starts.add(start);
  }
  return [...starts].sort((a, b) => a - b);
}

/**
 * Окна дня, когда общее время неизвестно: весь день 8–22, а сегодня — не
 * раньше `todayFrom` (уже прошедшее время встречей не назначить).
 */
export function openWindows(day: DateStr, today: DateStr, todayFrom: number): Interval[] {
  const from = day === today ? Math.max(PAIR_PLAN.dayStart, ceilTo(todayFrom, PAIR_PLAN.step)) : PAIR_PLAN.dayStart;
  return from < PAIR_PLAN.dayEnd ? [[from, PAIR_PLAN.dayEnd]] : [];
}

/**
 * Окна без уже назначенных встреч с этим же другом: на занятое вами двоими
 * время ни кнопки начала, ни готового варианта не предлагаем.
 */
export function withoutBooked(windows: readonly Interval[], booked: readonly Interval[]): Interval[] {
  if (booked.length === 0) return [...windows];
  return intersect(merge([...windows]), invert(booked, 0, 24 * 60));
}

/**
 * Готовые варианты сверху — как «Лучшее время» в группе: самое раннее
 * подходящее начало, по одному на день, первые `limit` дней, где встреча влезает.
 */
export function suggestStarts(
  days: readonly { day: DateStr; windows: readonly Interval[] }[],
  duration: number,
  limit: number = PAIR_PLAN.suggestions,
): { day: DateStr; start: number }[] {
  const picks: { day: DateStr; start: number }[] = [];
  for (const { day, windows } of days) {
    const [first] = startOptions(windows, duration);
    if (first === undefined) continue;
    picks.push({ day, start: first });
    if (picks.length >= limit) break;
  }
  return picks;
}

/** Выбранное время в машинном виде: «2026-10-28T15:00|60» — день, начало, длительность. */
export type PickedWhen = { day: DateStr; start: number; duration: number };

/**
 * Разобрать «2026-10-28T15:00|60». null — пришло не то: тогда встречу не
 * создаём, а не угадываем время по тексту.
 */
export function parsePickedWhen(value: string): PickedWhen | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})\|(\d{1,3})$/.exec(value.trim());
  if (!match || !isDateStr(match[1]!)) return null;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  const duration = Number(match[4]);
  if (hours > 23 || minutes > 59) return null;
  const start = hours * 60 + minutes;
  if (duration < 15 || start + duration > 24 * 60) return null;
  return { day: match[1] as DateStr, start, duration };
}

/** Дни плана: с сегодняшнего, `PAIR_PLAN.daysAhead` подряд. */
export function planDays(today: DateStr): DateStr[] {
  return Array.from({ length: PAIR_PLAN.daysAhead }, (_, offset) => addDays(today, offset));
}
