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
  /** Ряд — сам длинный перерыв (только на карте группы, см. `withBreakRows`). */
  pause?: boolean;
};

/**
 * Пары как на портале университета: по 50 минут с 08:00, после 3-й, 6-й и 9-й пары
 * перерыв 20 минут (10:50–11:10, 14:00–14:20, 17:10–17:30), иначе 10.
 */
export const LESSON_MIN = 50;
export const FIRST_LESSON = 8 * 60;
const SHORT_BREAK = 10;
const LONG_BREAK_AFTER: Record<number, number> = { 3: 20, 6: 20, 9: 20 };
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

/**
 * Ряды карты группы: длинные перерывы — тоже ряды со своими клетками. На них
 * можно назначить встречу, и встреча, которая через перерыв проходит, красит
 * его, а не рвётся посередине. В своём расписании перерывы остаются подписью:
 * пар там нет, красить нечего.
 */
export function withBreakRows(periods: readonly Period[]): Period[] {
  return periods.flatMap((period, index) => {
    if (index === 0 || period.breakBefore < BREAK_ROW_MIN) return [period];
    const pause: Period = { n: 0, start: periods[index - 1].end, end: period.start, breakBefore: 0, pause: true };
    return [pause, { ...period, breakBefore: 0 }];
  });
}

/** Ряд задевает интервал хотя бы частично. */
export function periodOverlaps(period: { start: number; end: number }, start: number, end: number): boolean {
  return period.start < end && start < period.end;
}

/**
 * Клетка редактора «Моё расписание»: «день:начало ряда». «Неудобно» лежит в
 * том же множестве с префиксом «~» — клетка бывает либо занятой, либо неудобной.
 */
export const SOFT_PREFIX = "~";
const SOFT_KIND = "soft";

export function editorKey(weekday: number, start: number, soft = false): string {
  return `${soft ? SOFT_PREFIX : ""}${weekday}:${start}`;
}

/** Клетки, которые интервал задевает в сетке редактора, по порядку рядов. */
function slotRows(periods: Period[], slot: WeeklySlot): { period: Period; key: string }[] {
  const soft = slot.kind === SOFT_KIND;
  return periods
    .filter((period) => periodOverlaps(period, slot.start, slot.end))
    .map((period) => ({ period, key: editorKey(slot.weekday, period.start, soft) }));
}

/** Закрашенные клетки сетки по сохранённым интервалам — так редактор открывается. */
export function editorCells(periods: Period[], slots: WeeklySlot[]): string[] {
  return [...new Set(slots.flatMap((slot) => slotRows(periods, slot).map((row) => row.key)))];
}

/**
 * Собрать сетку редактора обратно в интервалы, не теряя того, чего сетка не
 * показывает. Сетка знает только «клетка закрашена», а у интервала есть ещё
 * подпись («Матан»), чётность недели, вид (пары, работа, спорт) и точное время
 * внутри пары. Поэтому:
 *   - интервал, ни одной клетки которого не трогали, сохраняется как был —
 *     в том числе тот, что лежит вне часов группы и в сетке не виден;
 *   - у тронутого остаются его ещё закрашенные клетки — в его же границах,
 *     с его подписью, чётностью и видом;
 *   - новые клетки, подряд идущие в дне, — один интервал вместе с перерывами.
 * `base` — интервалы, по которым была раскрашена сетка до правок.
 */
export function editorSlots(periods: Period[], base: WeeklySlot[], cells: ReadonlySet<string>): WeeklySlot[] {
  const before = new Set(editorCells(periods, base));
  const changed = (key: string) => before.has(key) !== cells.has(key);
  const covered = new Set<string>();
  const result: WeeklySlot[] = [];

  for (const slot of base) {
    const rows = slotRows(periods, slot);
    if (!rows.some((row) => changed(row.key))) {
      result.push({ ...slot });
      for (const row of rows) covered.add(row.key);
      continue;
    }
    let run: Period[] = [];
    const flush = () => {
      if (run.length > 0) {
        result.push({
          ...slot,
          start: Math.max(slot.start, run[0].start),
          end: Math.min(slot.end, run[run.length - 1].end),
        });
      }
      run = [];
    };
    for (const row of rows) {
      if (cells.has(row.key)) {
        run.push(row.period);
        covered.add(row.key);
      } else {
        flush();
      }
    }
    flush();
  }

  for (const soft of [false, true]) {
    for (let weekday = 0; weekday < 7; weekday += 1) {
      let runStart: number | null = null;
      let previousEnd = 0;
      const flush = () => {
        if (runStart !== null) {
          result.push({ weekday, start: runStart, end: previousEnd, label: "", parity: null, kind: soft ? SOFT_KIND : "class" });
        }
        runStart = null;
      };
      for (const period of periods) {
        const key = editorKey(weekday, period.start, soft);
        if (cells.has(key) && !covered.has(key)) {
          if (runStart === null) runStart = period.start;
          previousEnd = period.end;
        } else {
          flush();
        }
      }
      flush();
    }
  }
  return result;
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
