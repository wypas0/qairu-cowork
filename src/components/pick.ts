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
