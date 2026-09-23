import { fmtMinutes } from "@/core/intervals";

/** Насколько далеко вперёд можно листать недели (на сервере значение то же). */
export const MAX_WEEK = 8;

/** Стенные часы группы: дата «ГГГГ-ММ-ДД» и минуты от полуночи. */
export type WallNow = { day: string; min: number };

/** Который сейчас час у группы — в её поясе, а не в поясе браузера. */
export function wallNow(tz: string, at: Date = new Date()): WallNow {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    min: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** h0 — свободны все (ярко-голубая клетка), h5 — никого (тёмно-синяя): светлее — полезнее окно. */
export function heatClass(count: number, total: number): string {
  if (!total || count <= 0) return "h5";
  const share = count / total;
  if (share >= 1) return "h0";
  if (share >= 0.8) return "h1";
  if (share >= 0.6) return "h2";
  if (share >= 0.4) return "h3";
  return "h4";
}

/** Сравнимый вид выбора участников: порядок щелчков значения не имеет. */
export function selectionKey(selected: number[] | null): string {
  return selected === null ? "all" : [...selected].sort((a, b) => a - b).join(",");
}

/**
 * Окно сегодняшнего дня начинается не раньше, чем сейчас (с округлением до
 * 10 минут вверх): встречу в прошедшее утро не назначить. Если от окна
 * осталось меньше длины встречи, оно пропадает. Другие дни не трогаем.
 */
export function clipToNow<T extends { start: number; end: number; text: string }>(
  date: string,
  item: T,
  now: WallNow | null,
  duration: number,
): T | null {
  if (!now || date !== now.day) return item;
  const from = Math.ceil(now.min / 10) * 10;
  if (item.start >= from) return item;
  if (item.end - from < duration) return null;
  return { ...item, start: from, text: `${fmtMinutes(from)}–${fmtMinutes(item.end)}` };
}
