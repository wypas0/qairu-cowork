import type { KeyboardEvent } from "react";

const STEPS: Record<string, [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

/**
 * Стрелки между клетками таблицы недели: карта группы и редактор своего
 * расписания. Ряды-перерывы пропускаются, на краю фокус стоит на месте.
 * Возвращает true, если нажатие было стрелкой, — тогда оно уже обработано
 * (прокрутку страницы стрелкой тоже отменяем).
 */
export function moveFocusByArrow(event: KeyboardEvent<HTMLElement>): boolean {
  const step = STEPS[event.key];
  if (!step || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  const cell = (event.target as HTMLElement).closest<HTMLElement>("td.cell");
  const body = cell?.closest("tbody");
  if (!cell || !body) return false;
  event.preventDefault();

  const rows = [...body.rows]
    .map((row) => [...row.cells].filter((td) => td.classList.contains("cell")))
    .filter((cells) => cells.length > 0);
  const row = rows.findIndex((cells) => cells.includes(cell as HTMLTableCellElement));
  if (row < 0) return true;
  const column = rows[row].indexOf(cell as HTMLTableCellElement);
  const next = rows[row + step[0]]?.[column + step[1]];
  next?.focus();
  return true;
}
