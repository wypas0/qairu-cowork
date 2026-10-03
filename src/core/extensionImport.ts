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
  return { id: message.id, slots, count };
}
