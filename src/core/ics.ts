/**
 * Занятость из календаря в формате iCalendar (.ics) — того, что отдают по
 * ссылке Google Календарь, Outlook, Apple и порталы вузов.
 *
 * На выходе — куски занятости по дням в поясе человека: «24.09, 09:00–10:30».
 * Названия событий сюда не попадают намеренно: календарь личный, а группе
 * нужно знать только, что человек занят.
 *
 * Понимает: время в UTC, с TZID и «плавающее»; события на весь день;
 * DTEND и DURATION; повторы RRULE (DAILY, WEEKLY с BYDAY, MONTHLY, YEARLY,
 * INTERVAL, COUNT, UNTIL); EXDATE; перенесённые повторы (RECURRENCE-ID);
 * отменённые (STATUS:CANCELLED) и «свободные» (TRANSP:TRANSPARENT) события
 * пропускает. Чего не понимает (например, «каждый второй вторник месяца»),
 * то берёт одной первой встречей, а не выдумывает.
 */

import {
  type DateStr,
  addDays,
  compareDates,
  dayOfMonth,
  diffDays,
  makeDate,
  monthOf,
  utcToZonedWall,
  weekdayOf,
  yearOf,
  zonedWallToUtc,
} from "./timeutils";

/** Момент события: либо день целиком, либо точное время. */
/** `tz` у точного времени — пояс, в котором считаются повторы (у UTC — сам UTC). */
type When = { kind: "date"; day: DateStr } | { kind: "instant"; at: Date; tz: string };

type Rule = {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  count: number | null;
  until: When | null;
  byDay: number[] | null; // 0 = понедельник
  byMonthDay: number[] | null;
  /** В правиле есть то, чего мы не понимаем: берём только первую встречу. */
  unsupported: boolean;
};

type RawEvent = {
  uid: string;
  start: When | null;
  end: When | null;
  durationMin: number | null;
  rule: Rule | null;
  exdates: When[];
  recurrenceId: When | null;
  skip: boolean;
};

export type IcsBusy = { day: DateStr; start: number; end: number };

/** Сколько кусков занятости выдаём максимум — защита от бесконечных правил. */
const MAX_PIECES = 3000;
/** Сколько повторов перебираем максимум на одно событие. */
const MAX_STEPS = 5000;

const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

/** Самые частые имена поясов Windows, которые пишет Outlook вместо IANA. */
const WINDOWS_ZONES: Record<string, string> = {
  "central asia standard time": "Asia/Almaty",
  "west asia standard time": "Asia/Tashkent",
  "ekaterinburg standard time": "Asia/Yekaterinburg",
  "russian standard time": "Europe/Moscow",
  "utc": "UTC",
  "gmt standard time": "Europe/London",
  "w. europe standard time": "Europe/Berlin",
  "turkey standard time": "Europe/Istanbul",
};

function validZone(name: string): string | null {
  const trimmed = name.trim().replace(/^"|"$/g, "");
  const mapped = WINDOWS_ZONES[trimmed.toLowerCase()] ?? trimmed;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: mapped });
    return mapped;
  } catch {
    return null;
  }
}

/** Склеить перенесённые строки: продолжение начинается с пробела или табуляции. */
function unfold(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}

/** «DTSTART;TZID=Asia/Almaty:20260922T090000» → имя, параметры, значение. */
function splitLine(line: string): { name: string; params: Record<string, string>; value: string } | null {
  const colon = line.indexOf(":");
  if (colon <= 0) return null;
  const [name, ...rawParams] = line.slice(0, colon).split(";");
  const params: Record<string, string> = {};
  for (const param of rawParams) {
    const eq = param.indexOf("=");
    if (eq > 0) params[param.slice(0, eq).toUpperCase()] = param.slice(eq + 1);
  }
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1).trim() };
}

function parseWhen(value: string, params: Record<string, string>, fallbackTz: string): When | null {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!match) return null;
  const day = makeDate(Number(match[1]), Number(match[2]), Number(match[3]));
  if (!match[4] || params.VALUE === "DATE") return { kind: "date", day };
  const minutes = Number(match[4]) * 60 + Number(match[5]);
  if (match[7]) {
    // Время в UTC: и повторы считаются в UTC, как велит стандарт, — иначе
    // серия съезжала бы на час при смене пояса страны.
    const at = new Date(`${day}T${match[4]}:${match[5]}:${match[6] ?? "00"}Z`);
    return { kind: "instant", at, tz: "UTC" };
  }
  const tz = (params.TZID && validZone(params.TZID)) || fallbackTz;
  return { kind: "instant", at: zonedWallToUtc(day, minutes, tz), tz };
}

/** «PT1H30M», «P1D», «P2W» → минуты. */
function parseDuration(value: string): number | null {
  const match = /^[+]?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!match) return null;
  const [, w, d, h, m] = match;
  return (Number(w ?? 0) * 7 + Number(d ?? 0)) * 1440 + Number(h ?? 0) * 60 + Number(m ?? 0);
}

function parseRule(value: string, fallbackTz: string): Rule | null {
  const parts = Object.fromEntries(
    value.split(";").map((part) => {
      const eq = part.indexOf("=");
      return [part.slice(0, eq).toUpperCase(), part.slice(eq + 1)];
    }),
  );
  const freq = parts.FREQ?.toUpperCase();
  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY" && freq !== "YEARLY") return null;
  let unsupported = false;
  let byDay: number[] | null = null;
  if (parts.BYDAY) {
    byDay = [];
    for (const token of parts.BYDAY.split(",")) {
      const match = /^([+-]?\d+)?(MO|TU|WE|TH|FR|SA|SU)$/.exec(token.trim().toUpperCase());
      // «1MO» — первый понедельник месяца и подобное не поддерживаем.
      if (!match || match[1]) unsupported = true;
      else byDay.push(WEEKDAYS.indexOf(match[2]));
    }
    if (freq !== "WEEKLY") unsupported = true;
  }
  const byMonthDay = parts.BYMONTHDAY
    ? parts.BYMONTHDAY.split(",").map(Number).filter((n: number) => n >= 1 && n <= 31)
    : null;
  if (parts.BYSETPOS || parts.BYWEEKNO || parts.BYYEARDAY || parts.BYHOUR || parts.BYMINUTE) unsupported = true;
  if (parts.BYMONTH && freq !== "YEARLY") unsupported = true;
  const interval = Math.max(1, Number(parts.INTERVAL ?? 1) || 1);
  const count = parts.COUNT ? Math.max(1, Number(parts.COUNT) || 1) : null;
  const until = parts.UNTIL ? parseWhen(parts.UNTIL, {}, fallbackTz) : null;
  return { freq, interval, count, until, byDay, byMonthDay, unsupported };
}

function readEvents(text: string, fallbackTz: string): RawEvent[] {
  const events: RawEvent[] = [];
  let current: RawEvent | null = null;
  let depth = 0; // вложенные блоки внутри VEVENT (VALARM) пропускаем
  for (const line of unfold(text)) {
    const upper = line.trim().toUpperCase();
    if (upper === "BEGIN:VEVENT") {
      current = { uid: "", start: null, end: null, durationMin: null, rule: null, exdates: [], recurrenceId: null, skip: false };
      depth = 0;
      continue;
    }
    if (!current) continue;
    if (upper === "END:VEVENT") {
      events.push(current);
      current = null;
      continue;
    }
    if (upper.startsWith("BEGIN:")) depth += 1;
    if (upper.startsWith("END:")) {
      depth -= 1;
      continue;
    }
    if (depth > 0) continue;
    const parsed = splitLine(line);
    if (!parsed) continue;
    const { name, params, value } = parsed;
    if (name === "UID") current.uid = value;
    else if (name === "DTSTART") current.start = parseWhen(value, params, fallbackTz);
    else if (name === "DTEND") current.end = parseWhen(value, params, fallbackTz);
    else if (name === "DURATION") current.durationMin = parseDuration(value);
    else if (name === "RRULE") current.rule = parseRule(value, fallbackTz);
    else if (name === "RECURRENCE-ID") current.recurrenceId = parseWhen(value, params, fallbackTz);
    else if (name === "EXDATE") {
      for (const item of value.split(",")) {
        const when = parseWhen(item, params, fallbackTz);
        if (when) current.exdates.push(when);
      }
    } else if (name === "STATUS" && value.toUpperCase() === "CANCELLED") current.skip = true;
    else if (name === "TRANSP" && value.toUpperCase() === "TRANSPARENT") current.skip = true;
  }
  return events;
}

/** Ключ повтора, по которому совпадают EXDATE и RECURRENCE-ID. */
function whenKey(when: When): string {
  return when.kind === "date" ? when.day : String(when.at.getTime());
}

/**
 * Дни, в которые приходятся повторы правила, начиная с `first` (включительно).
 * Без COUNT можно перескочить сразу к окну `windowStart`: серия, начатая
 * пять лет назад, иначе съела бы весь лимит шагов до нужных недель.
 */
function* ruleDays(first: DateStr, rule: Rule, windowStart: DateStr, lastDay: DateStr): Generator<DateStr> {
  let steps = 0;
  const jump = rule.count === null && compareDates(first, windowStart) < 0;
  if (rule.freq === "DAILY") {
    const skip = jump ? Math.max(0, Math.floor(diffDays(first, windowStart) / rule.interval) - 1) : 0;
    for (
      let day = addDays(first, skip * rule.interval);
      compareDates(day, lastDay) <= 0 && steps < MAX_STEPS;
      day = addDays(day, rule.interval)
    ) {
      steps += 1;
      yield day;
    }
    return;
  }
  if (rule.freq === "WEEKLY") {
    const weekdays = [...new Set(rule.byDay?.length ? rule.byDay : [weekdayOf(first)])].sort((a, b) => a - b);
    const monday = addDays(first, -weekdayOf(first));
    const weeksBefore = jump ? Math.floor(diffDays(monday, windowStart) / 7) : 0;
    const firstWeek = Math.max(0, Math.floor(weeksBefore / rule.interval) - 1) * rule.interval;
    for (let week = firstWeek; steps < MAX_STEPS; week += rule.interval) {
      const weekStart = addDays(monday, week * 7);
      if (compareDates(weekStart, lastDay) > 0) return;
      for (const weekday of weekdays) {
        const day = addDays(weekStart, weekday);
        if (compareDates(day, first) < 0) continue;
        if (compareDates(day, lastDay) > 0) return;
        steps += 1;
        yield day;
      }
    }
    return;
  }
  // MONTHLY и YEARLY — в тот же день месяца (или по BYMONTHDAY); несуществующие
  // даты (31 февраля) пропускаются, как велит стандарт.
  const monthsStep = rule.freq === "MONTHLY" ? rule.interval : rule.interval * 12;
  const days = rule.freq === "MONTHLY" && rule.byMonthDay?.length ? rule.byMonthDay : [dayOfMonth(first)];
  for (let offset = 0; steps < MAX_STEPS; offset += monthsStep) {
    const monthIndex = monthOf(first) - 1 + offset;
    const year = yearOf(first) + Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;
    if (compareDates(makeDate(year, month, 1), lastDay) > 0) return;
    for (const dom of [...days].sort((a, b) => a - b)) {
      const day = makeDate(year, month, dom);
      if (monthOf(day) !== month) continue; // 31-е в коротком месяце
      if (compareDates(day, first) < 0) continue;
      if (compareDates(day, lastDay) > 0) return;
      steps += 1;
      yield day;
    }
  }
}

/** Начала повторов события (включая первое), не дальше `lastDay`. */
function occurrences(event: RawEvent, windowStart: DateStr, lastDay: DateStr): When[] {
  const start = event.start!;
  if (!event.rule) return [start];
  if (event.rule.unsupported) return [start];
  const firstWall =
    start.kind === "date" ? { day: start.day, minutes: 0 } : utcToZonedWall(start.at, start.tz);
  const result: When[] = [];
  let produced = 0;
  for (const day of ruleDays(firstWall.day, event.rule, addDays(windowStart, -2), lastDay)) {
    const when: When =
      start.kind === "date"
        ? { kind: "date", day }
        : { kind: "instant", at: zonedWallToUtc(day, firstWall.minutes, start.tz), tz: start.tz };
    const until = event.rule.until;
    if (until) {
      const past =
        until.kind === "date"
          ? compareDates(day, until.day) > 0
          : when.kind === "instant"
            ? when.at.getTime() > until.at.getTime()
            : compareDates(day, utcToZonedWall(until.at, start.kind === "instant" ? start.tz : "UTC").day) > 0;
      if (past) break;
    }
    produced += 1;
    // COUNT считает повторы с самого начала, а не только попавшие в окно.
    if (event.rule.count !== null && produced > event.rule.count) break;
    result.push(when);
  }
  return result;
}

/** Длительность события в минутах (для события на весь день — в днях × 1440). */
function lengthMinutes(event: RawEvent): number {
  const start = event.start!;
  if (event.end) {
    if (start.kind === "date" && event.end.kind === "date") return diffDays(start.day, event.end.day) * 1440;
    if (start.kind === "instant" && event.end.kind === "instant") {
      return Math.round((event.end.at.getTime() - start.at.getTime()) / 60_000);
    }
  }
  if (event.durationMin !== null) return event.durationMin;
  // Без конца: день целиком для события на весь день, иначе — ноль (метка, не занятость).
  return start.kind === "date" ? 1440 : 0;
}

/**
 * Занятость из текста календаря в поясе `tz`, по дням с `fromDay` по `toDay`
 * включительно. Куски, пересекающие полночь, режутся по дням.
 */
export function busyFromIcs(text: string, tz: string, fromDay: DateStr, toDay: DateStr): IcsBusy[] {
  const all = readEvents(text, tz);
  const events = all.filter((event) => event.start && !event.skip);
  // Перенесённые и отменённые повторы: исходный повтор серии убираем.
  const moved = new Map<string, Set<string>>();
  for (const event of all) {
    if (!event.recurrenceId || !event.uid) continue;
    const set = moved.get(event.uid) ?? new Set<string>();
    set.add(whenKey(event.recurrenceId));
    moved.set(event.uid, set);
  }

  const pieces: IcsBusy[] = [];
  const push = (day: DateStr, start: number, end: number) => {
    if (end <= start) return;
    if (compareDates(day, fromDay) < 0 || compareDates(day, toDay) > 0) return;
    if (pieces.length < MAX_PIECES) pieces.push({ day, start, end });
  };

  for (const event of events) {
    const length = lengthMinutes(event);
    if (length <= 0) continue;
    const excluded = new Set(event.exdates.map(whenKey));
    const replaced = event.recurrenceId ? null : moved.get(event.uid);
    // Многодневное событие могло начаться до окна — берём запас на его длину.
    const windowStart = addDays(fromDay, -Math.ceil(length / 1440));
    for (const when of occurrences(event, windowStart, toDay)) {
      const key = whenKey(when);
      if (excluded.has(key) || replaced?.has(key)) continue;
      if (when.kind === "date") {
        const days = Math.max(1, Math.round(length / 1440));
        for (let offset = 0; offset < days; offset += 1) push(addDays(when.day, offset), 0, 1440);
        continue;
      }
      // Точное время: переводим в пояс человека и режем по полуночи.
      const startWall = utcToZonedWall(when.at, tz);
      const endWall = utcToZonedWall(new Date(when.at.getTime() + length * 60_000), tz);
      if (compareDates(startWall.day, toDay) > 0) continue;
      if (startWall.day === endWall.day) {
        push(startWall.day, startWall.minutes, endWall.minutes);
        continue;
      }
      push(startWall.day, startWall.minutes, 1440);
      for (let day = addDays(startWall.day, 1); compareDates(day, endWall.day) < 0; day = addDays(day, 1)) {
        push(day, 0, 1440);
      }
      push(endWall.day, 0, endWall.minutes);
    }
  }
  return pieces.sort((a, b) => a.day.localeCompare(b.day) || a.start - b.start);
}

/** Похоже ли это на календарь вообще — чтобы отличить .ics от страницы с ошибкой. */
export function looksLikeIcs(text: string): boolean {
  return /BEGIN:VCALENDAR/i.test(text.slice(0, 2000));
}
