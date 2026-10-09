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
    time: (value: Date) => time.format(value),
    dateTime: (value: Date) => dateTime.format(value),
    /** «09.10.26» — дата события в поясе сайта. */
    date: (value: Date | null) => (value ? date.format(value) : "—"),
    /** «2026-10-09» → «09.10»: календарный день, без сдвига пояса. */
    day: (value: string) => day.format(new Date(`${value}T12:00:00Z`)),
    percent: (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—"),
  };
}
export type Fmt = ReturnType<typeof formatters>;

export function bytes(t: T, value: number): string {
  return value >= MB ? t("w_owner_mb", { n: (value / MB).toFixed(1) }) : t("w_owner_kb", { n: Math.max(1, Math.round(value / 1024)) });
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
