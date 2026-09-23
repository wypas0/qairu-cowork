/**
 * Локализация: ru / kk / en.
 *
 * Использование:
 *     import { t } from "@/i18n";
 *     t(lang, "greeting", { name: "Амир" });
 *
 * Если ключа нет в выбранном языке — падаем на русский, потом на сам ключ.
 */

import type { DateStr } from "@/core/timeutils";
import { dayOfMonth, monthOf, weekdayOf } from "@/core/timeutils";
import { EN } from "./en";
import { KK } from "./kk";
import { RU } from "./ru";
import type { Strings } from "./types";

export type Lang = "ru" | "kk" | "en";
export type StringKey = keyof typeof RU;

export const LANGS: Record<Lang, Strings> = { ru: RU, kk: KK, en: EN };

export const LANG_NAMES: Record<Lang, string> = {
  ru: "🇷🇺 Русский",
  kk: "🇰🇿 Қазақша",
  en: "🇬🇧 English",
};

export const DEFAULT_LANG: Lang = "ru";

export const WEEKDAY_NAMES: Record<Lang, string[]> = {
  ru: ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"],
  kk: ["Дүйсенбі", "Сейсенбі", "Сәрсенбі", "Бейсенбі", "Жұма", "Сенбі", "Жексенбі"],
  en: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
};

/** Общепринятые сокращения — не первые буквы: «Чт», а не «Че». */
export const WEEKDAY_SHORT: Record<Lang, string[]> = {
  ru: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"],
  kk: ["Дс", "Сс", "Ср", "Бс", "Жм", "Сб", "Жс"],
  en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
};

export function weekdayShort(lang: string, index: number): string {
  const resolved: Lang = isLang(lang) ? lang : DEFAULT_LANG;
  return WEEKDAY_SHORT[resolved][((index % 7) + 7) % 7];
}

export const MONTH_NAMES: Record<Lang, string[]> = {
  ru: [
    "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря",
  ],
  kk: [
    "қаңтар", "ақпан", "наурыз", "сәуір", "мамыр", "маусым",
    "шілде", "тамыз", "қыркүйек", "қазан", "қараша", "желтоқсан",
  ],
  en: [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ],
};

export function isLang(value: unknown): value is Lang {
  return value === "ru" || value === "kk" || value === "en";
}

export function normalizeLang(code: string | null | undefined): Lang {
  if (!code) return DEFAULT_LANG;
  const short = code.split("-")[0].toLowerCase();
  return isLang(short) ? short : DEFAULT_LANG;
}

export type TParams = Record<string, string | number>;

export function t(lang: string, key: StringKey | string, params: TParams = {}): string {
  const resolved: Lang = isLang(lang) ? lang : DEFAULT_LANG;
  const template = LANGS[resolved][key] ?? (RU as Strings)[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
  );
}

/**
 * Строка с числом в правильной форме: «1 встреча», «3 встречи», «5 встреч».
 *
 * Форма выбирается по правилам языка (Intl.PluralRules): в русском их четыре
 * — one, few, many, other (дробные), в казахском и английском две. Ключи
 * лежат рядом: `key_one`, `key_few`, `key_many`, `key_other`; число
 * подставляется в `{n}`.
 */
export function tn(lang: string, key: string, n: number, params: TParams = {}): string {
  const resolved: Lang = isLang(lang) ? lang : DEFAULT_LANG;
  const category = new Intl.PluralRules(resolved).select(n);
  const dict = LANGS[resolved];
  const form = [`${key}_${category}`, `${key}_other`, `${key}_many`].find((name) => name in dict);
  return t(resolved, form ?? key, { n, ...params });
}

/** Готовая функция перевода для одного языка — удобно прокидывать в компоненты. */
export function translator(lang: string) {
  return (key: StringKey | string, params: TParams = {}) => t(lang, key, params);
}

export function weekdayName(lang: string, index: number): string {
  const resolved: Lang = isLang(lang) ? lang : DEFAULT_LANG;
  return WEEKDAY_NAMES[resolved][((index % 7) + 7) % 7];
}

/** date -> «среда, 9 сентября» / «Wednesday, September 9». */
export function formatDay(lang: string, day: DateStr): string {
  const resolved: Lang = isLang(lang) ? lang : DEFAULT_LANG;
  const weekday = weekdayName(resolved, weekdayOf(day));
  const month = MONTH_NAMES[resolved][monthOf(day) - 1];
  if (resolved === "en") return `${weekday}, ${month} ${dayOfMonth(day)}`;
  return `${weekday.toLowerCase()}, ${dayOfMonth(day)} ${month}`;
}
