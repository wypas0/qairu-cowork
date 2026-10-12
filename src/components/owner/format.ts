/** Числа, даты и размеры для консоли владельца — в языке и поясе владельца. */

import type { translator } from "@/i18n";
import { defaultTz } from "@/lib/config";

export type T = ReturnType<typeof translator>;

const LOCALES: Record<string, string> = { ru: "ru-RU", kk: "kk-KZ", en: "en-GB" };
const MB = 1024 * 1024;

export function formatters(lang: string) {
  const locale = LOCALES[lang] ?? "ru-RU";
  // Пустой или кривой DEFAULT_TZ сюда не доходит: defaultTz() сам откатывается на Алматы.
  const timeZone = defaultTz();
  const number = new Intl.NumberFormat(locale);
  const decimal = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const time = new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit" });
  const dateTime = new Intl.DateTimeFormat(locale, {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const date = new Intl.DateTimeFormat(locale, { timeZone, day: "2-digit", month: "2-digit", year: "2-digit" });
  const day = new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "2-digit", month: "2-digit" });
  return {
    timeZone,
    n: (value: number) => number.format(value),
    /** «1,4» — не больше одного знака после запятой, в языке владельца. */
    dec: (value: number) => decimal.format(value),
    time: (value: Date) => time.format(value),
    dateTime: (value: Date) => dateTime.format(value),
    /** «09.10.26» — дата события в поясе сайта. */
    date: (value: Date | null) => (value ? date.format(value) : "—"),
    /** «2026-10-09» → «09.10»: календарный день, без сдвига пояса. */
    day: (value: string) => day.format(new Date(`${value}T12:00:00Z`)),
    percent: (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—"),
    /** «8 / 9 · 89%»; когда спрашивать было не о чем — просто «—», без «0 / 0 · —». */
    ratio: (part: number, whole: number) =>
      whole > 0 ? `${number.format(part)} / ${number.format(whole)} · ${Math.round((part / whole) * 100)}%` : "—",
  };
}
export type Fmt = ReturnType<typeof formatters>;

export function bytes(t: T, value: number): string {
  return value >= MB ? t("w_owner_mb", { n: (value / MB).toFixed(1) }) : t("w_owner_kb", { n: Math.max(1, Math.round(value / 1024)) });
}

/**
 * Длительность для «Качества»: «120 мс», «1,4 с», «3,5 мин», «2 ч». Бесконечность
 * — замер за верхней границей гистограммы: «больше 6,4 с» (`cap` — граница).
 */
export function duration(t: T, fmt: Fmt, ms: number | null, cap?: number): string {
  if (ms === null) return "—";
  if (!Number.isFinite(ms)) return cap === undefined ? "—" : t("w_owner_q_over", { value: duration(t, fmt, cap) });
  if (ms < 1000) return t("w_owner_q_ms", { n: fmt.n(Math.round(ms)) });
  if (ms < 60_000) return t("w_owner_q_s", { n: fmt.dec(ms / 1000) });
  if (ms < 3_600_000) return t("w_owner_q_min", { n: fmt.dec(ms / 60_000) });
  return t("w_owner_q_h", { n: fmt.dec(ms / 3_600_000) });
}

/** Сколько полных дней прошло: «3» для действия трое суток назад. */
export function daysSince(value: Date, now = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - value.getTime()) / 86_400_000));
}

/** Две первые буквы имени — для кружка без фото. */
export function initials(name: string): string {
  const word = name.trim().replace(/^@/, "").split(/\s+/)[0] ?? "";
  const letters = [...word];
  return letters.length === 0 ? "?" : letters[0]!.toUpperCase() + (letters[1] ?? "").toLowerCase();
}

/** Откуда расписание — подпись из тех же строк, что у старосты в «Участниках». */
export function originName(t: T, origin: string | null): string {
  return origin === "campus"
    ? t("w_member_origin_campus")
    : origin === "photo"
      ? t("w_member_origin_photo")
      : t("w_member_origin_manual");
}

/** Лимит базы на бесплатном тарифе Supabase. */
export const DB_LIMIT_BYTES = 500 * 1024 * 1024;
