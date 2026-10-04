/**
 * Карта на телефоне — строки дня. Подряд идущие пары с одинаковым ответом
 * («4/4 свободны все» шесть раз) склеиваются в одну строку «1–6 пары»: иначе
 * страница группы на телефоне вырастала до трёх экранов одинаковых строк.
 * Перерывы между такими парами уходят внутрь склейки, по краям — остаются.
 */

/**
 * Строка дня: пара (её «подпись» — одинаковый ответ; null — не склеивать:
 * встреча, текущая пара) или перерыв без встречи.
 */
export type AgendaItem = { kind: "row"; sig: string | null } | { kind: "break" };

export type AgendaPart =
  | { type: "row"; index: number }
  | { type: "break"; index: number }
  /** Склейка: все строки от первой до последней пары, включая перерывы между ними. */
  | { type: "run"; covered: number[]; rows: number[] };

export function agendaRuns(items: readonly AgendaItem[], minRows = 2): AgendaPart[] {
  const parts: AgendaPart[] = [];
  let run: { sig: string; covered: number[]; rows: number[] } | null = null;
  // Перерывы после последней пары склейки: войдут в неё, только если за ними та же пара.
  let tail: number[] = [];

  function flush() {
    if (run) {
      if (run.rows.length >= minRows) {
        parts.push({ type: "run", covered: run.covered, rows: run.rows });
      } else {
        for (const index of run.covered) {
          parts.push(items[index]!.kind === "break" ? { type: "break", index } : { type: "row", index });
        }
      }
    }
    for (const index of tail) parts.push({ type: "break", index });
    run = null;
    tail = [];
  }

  items.forEach((item, index) => {
    if (item.kind === "break") {
      if (run) tail.push(index);
      else parts.push({ type: "break", index });
      return;
    }
    if (item.sig === null) {
      flush();
      parts.push({ type: "row", index });
      return;
    }
    if (run && run.sig === item.sig) {
      run.covered.push(...tail, index);
      run.rows.push(index);
      tail = [];
      return;
    }
    flush();
    run = { sig: item.sig, covered: [index], rows: [index] };
  });
  flush();
  return parts;
}
