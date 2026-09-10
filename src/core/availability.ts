/**
 * Вычисление общих свободных окон.
 *
 * Поверх `intervals.ts`. Про Telegram, БД и HTTP не знает.
 *
 * Поддерживает:
 * - повторяющиеся пары (каждую неделю и по чётности недели);
 * - разовую занятость на дату и на диапазон дат (сессия, поездка);
 * - буфер на дорогу — расширение каждой занятости на N минут с двух сторон;
 * - кворум: окна, где свободны не все, а хотя бы K человек.
 */

import { type Interval, coverageWindows, invert, merge, normalize, whoIsFree } from "./intervals";
import { type DateStr, addDays, compareDates, diffDays, weekdayOf } from "./timeutils";

// Чётность недели: 0 — числитель (верхняя), 1 — знаменатель (нижняя)
export const ODD = 0;
export const EVEN = 1;

export type ParityOf = (day: DateStr) => number;

/** Чётность недели относительно начала семестра (первая неделя — числитель). */
export function parityFromSemesterStart(semesterStart: DateStr): ParityOf {
  const monday = addDays(semesterStart, -weekdayOf(semesterStart));
  return (day: DateStr) => {
    const weeks = Math.floor(diffDays(monday, day) / 7);
    return ((weeks % 2) + 2) % 2;
  };
}

/** Запасной вариант: чётность по номеру ISO-недели (нечётная — числитель). */
export function parityFromIsoWeek(day: DateStr): number {
  const [year, month, dayOfMonth] = day.split("-").map(Number);
  const thursday = new Date(Date.UTC(year, month - 1, dayOfMonth));
  // Неделя ISO определяется своим четвергом — он всегда в «правильном» году.
  thursday.setUTCDate(thursday.getUTCDate() - ((thursday.getUTCDay() + 6) % 7) + 3);
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  firstThursday.setUTCDate(
    firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3,
  );
  const week =
    1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return (week + 1) % 2;
}

export type DateRangeSlot = {
  dateFrom: DateStr;
  dateTo: DateStr;
  start: number;
  end: number;
};

/** Занятость одного человека. */
export class PersonSchedule {
  userId: number;
  name: string;
  /** день недели -> интервалы (каждую неделю) */
  weekly: Map<number, Interval[]>;
  /** чётность -> день недели -> интервалы (пары через неделю) */
  weeklyParity: Map<number, Map<number, Interval[]>>;
  /** конкретная дата -> интервалы */
  dated: Map<DateStr, Interval[]>;
  /** сессия, поездка, «занят целиком» */
  ranges: DateRangeSlot[];
  hasData: boolean;

  constructor(init: {
    userId: number;
    name: string;
    weekly?: Map<number, Interval[]>;
    weeklyParity?: Map<number, Map<number, Interval[]>>;
    dated?: Map<DateStr, Interval[]>;
    ranges?: DateRangeSlot[];
    hasData?: boolean;
  }) {
    this.userId = init.userId;
    this.name = init.name;
    this.weekly = init.weekly ?? new Map();
    this.weeklyParity = init.weeklyParity ?? new Map();
    this.dated = init.dated ?? new Map();
    this.ranges = init.ranges ?? [];
    this.hasData = init.hasData ?? true;
  }

  busyOn(day: DateStr, parity: number | null = null, bufferMin = 0): Interval[] {
    const weekday = weekdayOf(day);
    let busy: Interval[] = [...(this.weekly.get(weekday) ?? [])];
    if (parity !== null) {
      busy = busy.concat(this.weeklyParity.get(parity)?.get(weekday) ?? []);
    }
    busy = busy.concat(this.dated.get(day) ?? []);
    for (const range of this.ranges) {
      if (compareDates(range.dateFrom, day) <= 0 && compareDates(day, range.dateTo) <= 0) {
        busy.push([range.start, range.end]);
      }
    }
    if (bufferMin) {
      busy = busy.map(([start, end]) => [start - bufferMin, end + bufferMin] as Interval);
    }
    return merge(busy);
  }
}

/** Свободное окно и кто в нём свободен. */
export type Window = {
  interval: Interval;
  freeIds: number[];
};

export type DayWindows = {
  day: DateStr;
  windows: Window[];
};

export type AvailabilityResult = {
  days: DayWindows[];
  participants: PersonSchedule[];
  missing: PersonSchedule[];
  dayStart: number;
  dayEnd: number;
  minSlot: number;
  quorum: number;
  /** true, если кворум = все участники */
  everyone: boolean;
};

export function anyWindows(result: AvailabilityResult): boolean {
  return result.days.some((day) => day.windows.length > 0);
}

function freeByUserFor(
  people: readonly PersonSchedule[],
  day: DateStr,
  dayStart: number,
  dayEnd: number,
  parityOf: ParityOf | null,
  bufferMin: number,
): Map<number, Interval[]> {
  const parity = parityOf ? parityOf(day) : null;
  const map = new Map<number, Interval[]>();
  for (const person of people) {
    map.set(
      person.userId,
      invert(normalize(person.busyOn(day, parity, bufferMin), dayStart, dayEnd), dayStart, dayEnd),
    );
  }
  return map;
}

/**
 * Свободные окна одного дня.
 *
 * quorum=null — нужны все; иначе достаточно `quorum` свободных человек.
 */
export function freeWindowsForDay(
  people: readonly PersonSchedule[],
  day: DateStr,
  dayStart: number,
  dayEnd: number,
  minSlot: number,
  quorum: number | null = null,
  parityOf: ParityOf | null = null,
  bufferMin = 0,
): Window[] {
  if (people.length === 0) return [];

  const freeByUser = freeByUserFor(people, day, dayStart, dayEnd, parityOf, bufferMin);
  const threshold = quorum === null ? people.length : Math.max(1, Math.min(quorum, people.length));

  const windows: Window[] = [];
  for (const [interval] of coverageWindows([...freeByUser.values()], threshold)) {
    if (interval[1] - interval[0] < minSlot) continue;
    windows.push({ interval, freeIds: whoIsFree(freeByUser, interval) });
  }
  return windows;
}

export type ComputeOptions = {
  daysAhead?: number;
  dayStart?: number;
  dayEnd?: number;
  minSlot?: number;
  quorum?: number | null;
  parityOf?: ParityOf | null;
  bufferMin?: number;
};

/** Свободные окна на `daysAhead` дней вперёд, начиная со `startDay`. */
export function computeAvailability(
  people: readonly PersonSchedule[],
  startDay: DateStr,
  options: ComputeOptions = {},
): AvailabilityResult {
  const {
    daysAhead = 7,
    dayStart = 8 * 60,
    dayEnd = 22 * 60,
    minSlot = 30,
    quorum = null,
    parityOf = null,
    bufferMin = 0,
  } = options;

  const withData = people.filter((person) => person.hasData);
  const missing = people.filter((person) => !person.hasData);

  const threshold =
    quorum === null ? withData.length : Math.max(1, Math.min(quorum, withData.length));

  const days: DayWindows[] = [];
  for (let offset = 0; offset < daysAhead; offset += 1) {
    const day = addDays(startDay, offset);
    days.push({
      day,
      windows: freeWindowsForDay(
        withData,
        day,
        dayStart,
        dayEnd,
        minSlot,
        quorum,
        parityOf,
        bufferMin,
      ),
    });
  }

  return {
    days,
    participants: withData,
    missing,
    dayStart,
    dayEnd,
    minSlot,
    quorum: threshold,
    everyone: threshold >= withData.length,
  };
}

/** Первые `limit` окон по хронологии — для кнопок выбора времени встречи. */
export function topSlots(
  result: AvailabilityResult,
  limit = 5,
): { day: DateStr; interval: Interval }[] {
  const slots: { day: DateStr; interval: Interval }[] = [];
  for (const day of result.days) {
    for (const window of day.windows) {
      slots.push({ day: day.day, interval: window.interval });
      if (slots.length >= limit) return slots;
    }
  }
  return slots;
}

/** Одна клетка сетки: сколько человек свободно на всём её протяжении. */
export type HeatCell = {
  startMin: number;
  endMin: number;
  freeIds: number[];
};

export type HeatDay = {
  day: DateStr;
  cells: HeatCell[];
};

/**
 * Тепловая карта недели: для каждой получасовой клетки — кто свободен.
 *
 * Это то, чего не может дать чат: одним взглядом видно, где «почти все»
 * свободны, а где провал. Клетка считается свободной только если человек
 * свободен на всём её протяжении — половинчатых значений нет намеренно,
 * иначе цвет обманывает.
 */
export function heatmap(
  people: readonly PersonSchedule[],
  startDay: DateStr,
  options: {
    daysAhead?: number;
    dayStart?: number;
    dayEnd?: number;
    step?: number;
    parityOf?: ParityOf | null;
    bufferMin?: number;
  } = {},
): HeatDay[] {
  const {
    daysAhead = 7,
    dayStart = 8 * 60,
    dayEnd = 22 * 60,
    step = 30,
    parityOf = null,
    bufferMin = 0,
  } = options;

  const withData = people.filter((person) => person.hasData);
  const result: HeatDay[] = [];

  for (let offset = 0; offset < daysAhead; offset += 1) {
    const day = addDays(startDay, offset);
    const freeByUser = freeByUserFor(withData, day, dayStart, dayEnd, parityOf, bufferMin);
    const cells: HeatCell[] = [];
    for (let start = dayStart; start < dayEnd; start += step) {
      const end = Math.min(start + step, dayEnd);
      cells.push({ startMin: start, endMin: end, freeIds: whoIsFree(freeByUser, [start, end]) });
    }
    result.push({ day, cells });
  }
  return result;
}
