/**
 * Разбор формы «разовая занятость» с сайта.
 *
 * Чистая функция без БД: одинаково работает в серверном действии и в тестах.
 */

import { type DateStr, addDays, compareDates, diffDays, isDateStr } from "./timeutils";

/** Период длиннее года — почти наверняка опечатка в годе. */
export const MAX_RANGE_DAYS = 366;

export type DatedBusyError = "date" | "range_order" | "range_long" | "time" | "past";

export type DatedBusy = {
  dateFrom: DateStr;
  /** null — занятость на одну дату, иначе последний день периода включительно. */
  dateTo: DateStr | null;
  start: number;
  end: number;
  label: string;
};

function parseTime(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const minutes = Number(match[2]);
  const total = Number(match[1]) * 60 + minutes;
  return minutes < 60 && total >= 0 && total <= 24 * 60 ? total : null;
}

/**
 * `dateTo` пустое или равное `dateFrom` — занятость на одну дату; иначе период.
 * «Весь день» занимает сутки целиком, иначе нужны оба времени, начало раньше конца.
 */
export function parseDatedBusy(
  input: {
    dateFrom: string;
    dateTo: string;
    allDay: boolean;
    start: string;
    end: string;
    label: string;
  },
  today: DateStr,
): { ok: true; value: DatedBusy } | { ok: false; error: DatedBusyError } {
  const dateFrom = input.dateFrom.trim();
  const rawTo = input.dateTo.trim();
  if (!isDateStr(dateFrom) || (rawTo && !isDateStr(rawTo))) return { ok: false, error: "date" };

  const dateTo = rawTo && rawTo !== dateFrom ? rawTo : null;
  if (dateTo && compareDates(dateTo, dateFrom) < 0) return { ok: false, error: "range_order" };
  if (dateTo && diffDays(dateFrom, dateTo) > MAX_RANGE_DAYS) return { ok: false, error: "range_long" };
  // Занятость целиком в прошлом ни на что не влияет — скорее всего, ошиблись годом.
  if (compareDates(dateTo ?? dateFrom, addDays(today, -1)) < 0) return { ok: false, error: "past" };

  let start = 0;
  let end = 24 * 60;
  if (!input.allDay) {
    const parsedStart = parseTime(input.start);
    const parsedEnd = parseTime(input.end);
    if (parsedStart === null || parsedEnd === null || parsedStart >= parsedEnd) {
      return { ok: false, error: "time" };
    }
    start = parsedStart;
    end = parsedEnd;
  }

  return {
    ok: true,
    value: { dateFrom, dateTo, start, end, label: input.label.trim().slice(0, 60) },
  };
}
