/**
 * Работа с датами и часовыми поясами. Общее для бота и сайта.
 *
 * Календарная дата везде представлена строкой `YYYY-MM-DD` — ровно тем, что
 * хранит и возвращает Postgres-тип `date`. Через JS `Date` календарные даты
 * не гоняются намеренно: локальный пояс процесса на Vercel (UTC) не совпадает
 * с поясом группы, и `new Date("2026-09-14")` уехал бы на день.
 */

export type DateStr = string; // YYYY-MM-DD

export const DEFAULT_TZ = "Asia/Almaty";

/** Проверить, что такой часовой пояс существует; иначе — запасной. */
export function tzOf(name: string | null | undefined, fallback: string = DEFAULT_TZ): string {
  const candidate = name || fallback;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate });
    return candidate;
  } catch {
    return fallback;
  }
}

export function chatTz(chat: { tz?: string | null } | null | undefined, fallback = DEFAULT_TZ): string {
  return tzOf(chat?.tz ?? null, fallback);
}

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function partsIn(date: Date, tz: string): Parts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const found: Record<string, number> = {};
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== "literal") found[part.type] = Number(part.value);
  }
  return {
    year: found.year,
    month: found.month,
    day: found.day,
    hour: found.hour % 24,
    minute: found.minute,
    second: found.second,
  };
}

/** Смещение пояса в миллисекундах для конкретного момента (wall − UTC). */
function tzOffsetMs(date: Date, tz: string): number {
  const p = partsIn(date, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - date.getTime();
}

export function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function makeDate(year: number, month: number, day: number): DateStr {
  return `${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}`;
}

/** Сегодняшняя календарная дата в указанном поясе. */
export function todayIn(tz: string, now: Date = new Date()): DateStr {
  const p = partsIn(now, tzOf(tz));
  return makeDate(p.year, p.month, p.day);
}

export function isDateStr(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(dateToUtcMs(value));
}

function dateToUtcMs(value: DateStr): number {
  const [y, m, d] = value.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d);
  const back = new Date(ms);
  // Отсекаем «32 сентября»: Date.UTC молча переносит на следующий месяц.
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) {
    return Number.NaN;
  }
  return ms;
}

function utcMsToDate(ms: number): DateStr {
  const d = new Date(ms);
  return makeDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function addDays(value: DateStr, days: number): DateStr {
  return utcMsToDate(dateToUtcMs(value) + days * 86_400_000);
}

export function diffDays(from: DateStr, to: DateStr): number {
  return Math.round((dateToUtcMs(to) - dateToUtcMs(from)) / 86_400_000);
}

/** 0 = понедельник … 6 = воскресенье (как `date.weekday()` в Python). */
export function weekdayOf(value: DateStr): number {
  return (new Date(dateToUtcMs(value)).getUTCDay() + 6) % 7;
}

export function compareDates(a: DateStr, b: DateStr): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function dayOfMonth(value: DateStr): number {
  return Number(value.slice(8, 10));
}

export function monthOf(value: DateStr): number {
  return Number(value.slice(5, 7));
}

export function yearOf(value: DateStr): number {
  return Number(value.slice(0, 4));
}

/** 2026-09-14 -> «14.09.2026». */
export function formatDMY(value: DateStr): string {
  return `${value.slice(8, 10)}.${value.slice(5, 7)}.${value.slice(0, 4)}`;
}

/** 2026-09-14 -> «14.09». */
export function formatDM(value: DateStr): string {
  return `${value.slice(8, 10)}.${value.slice(5, 7)}`;
}

/**
 * Момент времени по календарной дате, минутам от полуночи и поясу.
 *
 * Смещение подбирается за две итерации: первая даёт приблизительный момент,
 * вторая уточняет его в переходах на летнее время.
 */
export function zonedWallToUtc(value: DateStr, minutes: number, tz: string): Date {
  const zone = tzOf(tz);
  const [y, m, d] = value.split("-").map(Number);
  const naive = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  let ts = naive - tzOffsetMs(new Date(naive), zone);
  ts = naive - tzOffsetMs(new Date(ts), zone);
  return new Date(ts);
}

/** Обратное к zonedWallToUtc: календарная дата и минуты от полуночи в поясе. */
export function utcToZonedWall(date: Date, tz: string): { day: DateStr; minutes: number } {
  const p = partsIn(date, tzOf(tz));
  return { day: makeDate(p.year, p.month, p.day), minutes: p.hour * 60 + p.minute };
}

/** «12.09», «12.09.2026», «12/09» -> дата. Год подставляется ближайший будущий. */
export function parseDateToken(token: string, today: DateStr): DateStr | null {
  const match = /^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?$/.exec(token.trim());
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  let year: number;
  if (match[3]) {
    year = Number(match[3]);
    if (year < 100) year += 2000;
  } else {
    year = yearOf(today);
  }
  let result = makeDate(year, month, day);
  if (Number.isNaN(dateToUtcMs(result))) return null;
  if (!match[3] && compareDates(result, today) < 0) {
    result = makeDate(year + 1, month, day);
    if (Number.isNaN(dateToUtcMs(result))) return null;
  }
  return result;
}

/**
 * Сколько осталось до начала, если меньше суток: «через 40 мин», «через 2 ч».
 * До часа — минуты (не меньше одной), дальше — часы с округлением. Начавшееся
 * и далёкое — null: там метка ничего не добавляет к дате.
 */
export function startsSoon(start: Date, now: Date): { unit: "min" | "h"; n: number } | null {
  const minutes = (start.getTime() - now.getTime()) / 60_000;
  if (minutes <= 0 || minutes >= 24 * 60) return null;
  if (minutes < 60) return { unit: "min", n: Math.max(1, Math.round(minutes)) };
  return { unit: "h", n: Math.round(minutes / 60) };
}
