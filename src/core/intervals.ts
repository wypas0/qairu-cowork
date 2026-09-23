/**
 * Алгебра временных отрезков.
 *
 * Все интервалы — полуинтервалы [start, end) в минутах от полуночи.
 * Модуль намеренно не знает ни про Telegram, ни про БД, ни про React:
 * чистые функции, которые полностью покрываются юнит-тестами.
 */

export type Interval = readonly [number, number];

/** Обрезать интервалы по границам [lo, hi) и выбросить пустые/некорректные. */
export function normalize(intervals: readonly Interval[], lo = 0, hi = 24 * 60): Interval[] {
  const out: Interval[] = [];
  for (const [start, end] of intervals) {
    const s = Math.max(Math.trunc(start), lo);
    const e = Math.min(Math.trunc(end), hi);
    if (s < e) out.push([s, e]);
  }
  return out;
}

/**
 * Слить пересекающиеся и смежные интервалы. O(n log n).
 *
 * Смежные (9:00-10:00 и 10:00-11:00) сливаются намеренно: между двумя
 * парами подряд нет окна.
 */
export function merge(intervals: readonly Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  const ordered = intervals
    .map(([s, e]) => [Math.trunc(s), Math.trunc(e)] as Interval)
    .filter(([s, e]) => s < e)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (ordered.length === 0) return [];

  const merged: [number, number][] = [[ordered[0][0], ordered[0][1]]];
  for (let i = 1; i < ordered.length; i += 1) {
    const [start, end] = ordered[i];
    const last = merged[merged.length - 1];
    if (start <= last[1]) {
      // пересекаются или касаются
      if (end > last[1]) last[1] = end;
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
}

/** Дополнение занятости до рабочего окна [lo, hi) — свободные интервалы. */
export function invert(busy: readonly Interval[], lo: number, hi: number): Interval[] {
  if (lo >= hi) return [];
  const free: Interval[] = [];
  let cursor = lo;
  for (const [start, end] of merge(normalize(busy, lo, hi))) {
    if (start > cursor) free.push([cursor, start]);
    cursor = Math.max(cursor, end);
  }
  if (cursor < hi) free.push([cursor, hi]);
  return free;
}

/** Пересечение двух отсортированных непересекающихся списков. O(n+m). */
export function intersect(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const result: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const start = Math.max(a[i][0], b[j][0]);
    const end = Math.min(a[i][1], b[j][1]);
    if (start < end) result.push([start, end]);
    // двигаем тот, что заканчивается раньше
    if (a[i][1] <= b[j][1]) i += 1;
    else j += 1;
  }
  return result;
}

/**
 * Пересечение произвольного числа наборов свободных интервалов.
 *
 * Пустой список групп — это ошибка вызывающего кода, а не «все свободны»:
 * возвращаем пустой результат, чтобы не показать ложные окна.
 */
export function intersectAll(groups: readonly (readonly Interval[])[], lo: number, hi: number): Interval[] {
  if (groups.length === 0) return [];
  let common: Interval[] = [[lo, hi]];
  for (const group of groups) {
    common = intersect(common, merge(normalize(group, lo, hi)));
    if (common.length === 0) return [];
  }
  return common;
}

/** Отсеять окна короче `minimum` минут. */
export function filterMinDuration(intervals: readonly Interval[], minimum: number): Interval[] {
  return intervals.filter(([s, e]) => e - s >= minimum).map(([s, e]) => [s, e] as Interval);
}

export function totalMinutes(intervals: readonly Interval[]): number {
  return intervals.reduce((sum, [s, e]) => sum + (e - s), 0);
}

/** 540 -> '09:00'. Значение 1440 отображается как '24:00'. */
export function fmtMinutes(value: number): string {
  const v = Math.max(0, Math.trunc(value));
  const h = Math.floor(v / 60);
  const m = v % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** '9:30' / '09:30' / '9' -> минуты от полуночи; null, если это не время суток. */
export function parseClock(value: string): number | null {
  const match = /^(\d{1,2})(?::(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const minutes = Number(match[2] ?? 0);
  const total = Number(match[1]) * 60 + minutes;
  return minutes < 60 && total <= 24 * 60 ? total : null;
}

export function fmtInterval(interval: Interval): string {
  return `${fmtMinutes(interval[0])}–${fmtMinutes(interval[1])}`;
}

/**
 * Окна, в которых одновременно свободны хотя бы `minCount` человек.
 *
 * Заметающая прямая: каждый свободный интервал даёт +1 в начале и -1 в конце.
 * Смежные участки со счётчиком >= порога склеиваются в одно окно; вторым
 * элементом возвращается МИНИМАЛЬНЫЙ счётчик на этом окне — то есть
 * «на всём окне свободны как минимум столько».
 */
export function coverageWindows(
  freeSets: readonly (readonly Interval[])[],
  minCount: number,
): [Interval, number][] {
  if (minCount <= 0 || freeSets.length === 0) return [];

  const events: [number, number][] = [];
  for (const intervals of freeSets) {
    for (const [start, end] of merge(intervals)) {
      events.push([start, 1]);
      events.push([end, -1]);
    }
  }
  if (events.length === 0) return [];
  // Питоновский sort кортежей: сначала по позиции, потом по дельте (-1 раньше +1).
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const result: [Interval, number][] = [];
  let count = 0;
  let segmentStart: number | null = null;
  let segmentMin = 0;
  let index = 0;

  while (index < events.length) {
    const position = events[index][0];
    if (segmentStart !== null && position > segmentStart) {
      segmentMin = Math.min(segmentMin, count);
    }
    while (index < events.length && events[index][0] === position) {
      count += events[index][1];
      index += 1;
    }
    if (count >= minCount) {
      if (segmentStart === null) {
        segmentStart = position;
        segmentMin = count;
      } else {
        segmentMin = Math.min(segmentMin, count);
      }
    } else if (segmentStart !== null) {
      result.push([[segmentStart, position], segmentMin]);
      segmentStart = null;
    }
  }
  return result;
}

/** Кто свободен на протяжении всего окна целиком. */
export function whoIsFree(freeByUser: Map<number, Interval[]>, window: Interval): number[] {
  const [start, end] = window;
  const out: number[] = [];
  for (const [userId, intervals] of freeByUser) {
    if (merge(intervals).some(([s, e]) => s <= start && end <= e)) out.push(userId);
  }
  return out;
}
