/**
 * Сетка недели: ряды получасовых клеток и разбор того, что присылает редактор.
 *
 * Чистые функции без БД и HTTP — ровно то, что должно быть одинаковым
 * на сервере, в API и в тестах.
 */

export type WeeklySlot = {
  weekday: number;
  start: number;
  end: number;
  label: string;
  parity: number | null;
  kind: string;
};

/** Начала клеток рабочего дня: 08:00, 08:30, … — последняя не выходит за границу. */
export function slotTimes(dayStart: number, dayEnd: number, step: number): number[] {
  const times: number[] = [];
  if (step <= 0) return times;
  for (let value = dayStart; value < dayEnd; value += step) times.push(value);
  return times;
}

/** Строка сетки: пара университета или, если пары не влезают в часы группы, отрезок по шагу. */
export type Period = {
  /** Номер пары; 0 — ряд без номера (запасная сетка по шагу). */
  n: number;
  start: number;
  end: number;
  /** Перерыв перед этим рядом, минуты: показываем его отдельной строкой, если он длинный. */
  breakBefore: number;
};

/** Пары как на портале университета: по 50 минут с 08:00, после 3-й перерыв 20 минут, иначе 10. */
export const LESSON_MIN = 50;
export const FIRST_LESSON = 8 * 60;
const SHORT_BREAK = 10;
const LONG_BREAK_AFTER: Record<number, number> = { 3: 20 };
/** Перерыв от стольких минут выделяется отдельной строкой. */
export const BREAK_ROW_MIN = 20;

/** Пары, целиком попадающие в часы группы. Нумерация — университетская: 08:00 всегда 1-я. */
export function lessonPeriods(dayStart: number, dayEnd: number): Period[] {
  const periods: Period[] = [];
  let start = FIRST_LESSON;
  for (let n = 1; start + LESSON_MIN <= 24 * 60; n += 1) {
    const end = start + LESSON_MIN;
    if (start >= dayStart && end <= dayEnd) {
      const previous = periods[periods.length - 1];
      periods.push({ n, start, end, breakBefore: previous ? start - previous.end : 0 });
    }
    start = end + (LONG_BREAK_AFTER[n] ?? SHORT_BREAK);
  }
  return periods;
}

/** Ряды сетки недели: пары, а если часы группы уже одной пары — прежние отрезки по шагу. */
export function gridPeriods(dayStart: number, dayEnd: number, step: number): Period[] {
  const lessons = lessonPeriods(dayStart, dayEnd);
  if (lessons.length > 0) return lessons;
  return slotTimes(dayStart, dayEnd, step).map((start) => ({
    n: 0,
    start,
    end: Math.min(start + step, dayEnd),
    breakBefore: 0,
  }));
}

/** Ряд задевает интервал хотя бы частично. */
export function periodOverlaps(period: { start: number; end: number }, start: number, end: number): boolean {
  return period.start < end && start < period.end;
}

type IncomingSlot = {
  weekday?: unknown;
  start?: unknown;
  end?: unknown;
  label?: unknown;
  parity?: unknown;
  kind?: unknown;
};

/**
 * Отфильтровать то, что прислал браузер.
 *
 * Битые строки молча отбрасываются, а не роняют весь запрос: потерять одну
 * пару из-за опечатки в клиенте лучше, чем не сохранить расписание целиком.
 */
export function cleanIncomingSlots(rows: unknown, limit = 400): WeeklySlot[] {
  if (!Array.isArray(rows)) return [];
  const cleaned: WeeklySlot[] = [];

  for (const raw of rows.slice(0, limit)) {
    if (typeof raw !== "object" || raw === null) continue;
    const row = raw as IncomingSlot;

    const weekday = Number(row.weekday);
    const start = Number(row.start);
    const end = Number(row.end);
    if (!Number.isInteger(weekday) || !Number.isInteger(start) || !Number.isInteger(end)) continue;
    if (weekday < 0 || weekday > 6) continue;
    if (!(start >= 0 && start < end && end <= 24 * 60)) continue;

    const parity =
      row.parity === 0 || row.parity === 1 || row.parity === "0" || row.parity === "1"
        ? Number(row.parity)
        : null;

    cleaned.push({
      weekday,
      start,
      end,
      label: String(row.label ?? "").slice(0, 60),
      parity,
      kind: String(row.kind ?? "class").slice(0, 16),
    });
  }
  return cleaned;
}
