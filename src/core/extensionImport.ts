/**
 * Пары из расширения «расписание из кампуса» (репозиторий qairu-schedule-ext).
 *
 * Расширение считывает расписание с campus.qairu.edu.kz и передаёт его
 * странице «Моё расписание» через window.postMessage:
 *
 *   страница → расширение  { source: PAGE_SOURCE, type: "campus-ready" }
 *   расширение → страница  { source: EXT_SOURCE, type: "campus-slots", id, slots, meetings }
 *   страница → расширение  { source: PAGE_SOURCE, type: "campus-received", id }
 *
 * С 0.4.0 — «Перенести из кампуса» (ExtensionHint):
 *
 *   страница → расширение  { source: PAGE_SOURCE, type: "campus-intent", title, lang }
 *   расширение → страница  { source: EXT_SOURCE, type: "campus-intent-ok" }
 *
 * Расширение запоминает группу (по адресу страницы) на час, сайт открывает
 * кампус, там расширение само предлагает перенос карточкой и возвращает
 * человека сюда — с теми же campus-slots на проверку.
 *
 * Сообщению не доверяем: оно проходит ту же проверку, что сохранение с
 * сайта, вид пары — только из списка распознавания (иначе пришедшее
 * «soft» стало бы «неудобно»), и ничего не сохраняется без кнопки «Сохранить».
 */

import { cleanIncomingSlots } from "./grid";
import { fmtMinutes } from "./intervals";

export const EXT_SOURCE = "qairu-schedule-ext";
export const PAGE_SOURCE = "qairu-cowork";

/** Столько же пар, сколько принимает импорт с фото. */
const MAX_SLOTS = 80;
const KINDS = new Set(["lecture", "practice", "lab", "seminar", "other"]);

export type ExtensionSlot = {
  weekday: number;
  start: number;
  end: number;
  label: string;
  parity: number | null;
  kind: string;
  /** «08:00–09:50» — для списка под сеткой. */
  text: string;
};

export type ExtensionImport = {
  id: string;
  slots: ExtensionSlot[];
  /** Пар в неделю по словам расширения (до склейки соседних); иначе число промежутков. */
  count: number;
  /** Версия расширения, если оно её прислало. */
  version: string | null;
};

/** Разобрать сообщение расширения; не его или пустое — null. */
export function readExtensionMessage(data: unknown): ExtensionImport | null {
  if (typeof data !== "object" || data === null) return null;
  const message = data as Record<string, unknown>;
  if (message.source !== EXT_SOURCE || message.type !== "campus-slots") return null;
  if (typeof message.id !== "string" || message.id.length === 0 || message.id.length > 64) return null;

  const slots = cleanIncomingSlots(message.slots, MAX_SLOTS).map((slot) => ({
    ...slot,
    label: slot.label.replace(/[\u0000-\u001f\u007f]/g, " ").trim(),
    kind: KINDS.has(slot.kind) ? slot.kind : "other",
    text: `${fmtMinutes(slot.start)}–${fmtMinutes(slot.end)}`,
  }));
  if (slots.length === 0) return null;

  const meetings = Number(message.meetings);
  const count = Number.isInteger(meetings) && meetings >= slots.length && meetings <= 200 ? meetings : slots.length;
  const version =
    typeof message.version === "string" && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(message.version) ? message.version : null;
  return { id: message.id, slots, count, version };
}

/** Отчёт расширения о поломке: кампус отдал страницу, а расписания в ней нет. */
export type ExtensionReport = {
  kind: "not_found";
  version: string;
  locale: "ru" | "kk" | "en";
  html: number;
  flight: number;
  grid: boolean;
  sections: number;
};

const size = (value: unknown, max: number) =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max ? value : null;

/**
 * Разобрать отчёт. Адрес открыт для всех, поэтому принимаем только числа,
 * флаг и коды из списка — никакого свободного текста в сообщение бота.
 */
export function readExtensionReport(data: unknown): ExtensionReport | null {
  if (typeof data !== "object" || data === null) return null;
  const body = data as Record<string, unknown>;
  if (body.kind !== "not_found") return null;
  if (typeof body.version !== "string" || !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(body.version)) return null;
  if (body.locale !== "ru" && body.locale !== "kk" && body.locale !== "en") return null;
  const html = size(body.html, 50_000_000);
  const flight = size(body.flight, 50_000_000);
  const sections = size(body.sections, 10_000);
  if (html === null || flight === null || sections === null || typeof body.grid !== "boolean") return null;
  return { kind: "not_found", version: body.version, locale: body.locale, html, flight, grid: body.grid, sections };
}

/**
 * Последняя версия расширения — та, что лежит в public/downloads. Распакованное
 * расширение само не обновляется, поэтому сайт сравнивает её с присланной
 * расширением и предлагает обновиться. Менять вместе с архивом.
 */
export const LATEST_EXTENSION = "0.4.0";
export const EXTENSION_ZIP = "/downloads/qairu-schedule-ext.zip";
/**
 * Под этим именем архив сохраняется при скачивании. «Извлечь всё» в Windows
 * и распаковка на macOS кладут файлы в папку с тем же именем — её и выбирают
 * в «Загрузить распакованное». Без версии: папку при обновлении не меняют.
 */
export const EXTENSION_ZIP_NAME = "QairuCowork-extension.zip";
export const EXTENSION_FOLDER = "QairuCowork-extension";
/** С этой версии расширение умеет «Перенести из кампуса». */
export const INTENT_EXTENSION = "0.4.0";

/** Страница расписания кампуса на языке сайта (кампус говорит на тех же трёх). */
export function campusScheduleUrl(lang: string): string {
  const locale = lang === "kk" || lang === "en" ? lang : "ru";
  return `https://campus.qairu.edu.kz/${locale}/schedule`;
}

/** Версия расширения умеет «Перенести из кампуса». */
export function supportsIntent(version: string | null): boolean {
  return !!version && !olderVersion(version, INTENT_EXTENSION);
}

/** Версия a старше b («0.1.0» < «0.2.0»). */
export function olderVersion(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}
