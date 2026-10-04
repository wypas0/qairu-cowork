/**
 * Карта на телефоне: одинаковые пары подряд склеиваются в одну строку.
 */

import { describe, expect, it } from "vitest";

import { type AgendaItem, agendaRuns } from "@/components/board/agenda";

const row = (sig: string | null): AgendaItem => ({ kind: "row", sig });
const pause: AgendaItem = { kind: "break" };

describe("agendaRuns", () => {
  it("шесть одинаковых пар с перерывом между ними — одна строка", () => {
    const items = [row("4/4"), row("4/4"), row("4/4"), pause, row("4/4"), row("4/4"), row("4/4")];
    expect(agendaRuns(items)).toEqual([{ type: "run", covered: [0, 1, 2, 3, 4, 5, 6], rows: [0, 1, 2, 4, 5, 6] }]);
  });

  it("перерыв на стыке разных ответов остаётся отдельной строкой", () => {
    const items = [row("4/4"), row("4/4"), pause, row("3/4"), row("3/4")];
    expect(agendaRuns(items)).toEqual([
      { type: "run", covered: [0, 1], rows: [0, 1] },
      { type: "break", index: 2 },
      { type: "run", covered: [3, 4], rows: [3, 4] },
    ]);
  });

  it("одиночная пара не склеивается, встреча и текущая пара — никогда", () => {
    const items = [row("4/4"), row(null), row("4/4"), row("4/4"), row(null), row("2/4")];
    expect(agendaRuns(items)).toEqual([
      { type: "row", index: 0 },
      { type: "row", index: 1 },
      { type: "run", covered: [2, 3], rows: [2, 3] },
      { type: "row", index: 4 },
      { type: "row", index: 5 },
    ]);
  });

  it("одна пара между перерывами — строки идут как были", () => {
    const items = [pause, row("4/4"), pause, row("3/4")];
    expect(agendaRuns(items)).toEqual([
      { type: "break", index: 0 },
      { type: "row", index: 1 },
      { type: "break", index: 2 },
      { type: "row", index: 3 },
    ]);
  });

  it("ни одна строка не теряется и не повторяется", () => {
    const items = [row("a"), pause, row("a"), row("b"), pause, pause, row("b"), row(null), row("c"), pause];
    const seen = agendaRuns(items).flatMap((part) => (part.type === "run" ? part.covered : [part.index]));
    expect(seen).toEqual(items.map((_, index) => index));
  });
});
