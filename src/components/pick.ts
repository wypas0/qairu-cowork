import { fmtMinutes } from "@/core/intervals";

/**
 * «Назначить встречу на это время» — событие, которым доска и карточки встреч
 * говорят форме встречи, что подставить. Форма и вкладки слушают его сами,
 * поэтому кнопке не нужно знать, где на странице форма.
 */
export const PICK_EVENT = "qairu:pick";

export type PickDetail = {
  /** Время в машинном виде: «2026-09-24T15:00|90» — день, начало, длительность. */
  value: string;
  /** То же время словами — его видит человек. */
  text: string;
  /** «Повторить встречу»: цель и место прошлой встречи. */
  goal?: string;
  place?: string;
};

export function pickMeeting(detail: PickDetail): void {
  window.dispatchEvent(new CustomEvent<PickDetail>(PICK_EVENT, { detail }));
}

const RANGE = /(\d{1,2})[:.](\d{2})\s*[–—-]\s*(\d{1,2})[:.](\d{2})/;

/**
 * Человек выбрал время на карте и поправил в поле только часы: «сб · 10:00–10:50»
 * → «сб · 10:00–14:00». День тот же, поэтому точное время остаётся — с новыми
 * началом и длиной. Раньше любая правка превращала встречу в простой текст:
 * она пропадала с карты и из календаря, бот не напоминал. На телефоне так
 * продлевают встречу чаще всего — протяжки пальцем там нет.
 *
 * Если поменялось что-то кроме часов (день, приписка), разбирать фразу не
 * беремся — null, уйдёт текст, как раньше.
 */
export function repick(base: PickDetail, text: string): PickDetail | null {
  const was = RANGE.exec(base.text);
  const now = RANGE.exec(text);
  if (!was || !now) return null;
  if (text.slice(0, now.index).trim() !== base.text.slice(0, was.index).trim()) return null;
  if (text.slice(now.index + now[0].length).trim() !== base.text.slice(was.index + was[0].length).trim()) return null;
  const [h1, m1, h2, m2] = now.slice(1).map(Number);
  if (h1 > 23 || h2 > 24 || m1 > 59 || m2 > 59) return null;
  const start = h1 * 60 + m1;
  const end = h2 * 60 + m2;
  if (end <= start || end > 24 * 60) return null;
  const day = base.value.slice(0, 10);
  return { ...base, value: `${day}T${fmtMinutes(start)}|${end - start}`, text };
}
