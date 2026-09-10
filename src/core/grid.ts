/**
 * Сетка недели: ряды получасовых клеток и разбор того, что присылает редактор.
 *
 * Чистые функции без БД и HTTP — ровно то, что должно быть одинаковым
 * на сервере, в API и в тестах.
 */

export type WeeklySlot = {
  weekday: number;
  start: number;
  end: number;
  label: string;
  parity: number | null;
  kind: string;
};

/** Начала клеток рабочего дня: 08:00, 08:30, … — последняя не выходит за границу. */
export function slotTimes(dayStart: number, dayEnd: number, step: number): number[] {
  const times: number[] = [];
  if (step <= 0) return times;
  for (let value = dayStart; value < dayEnd; value += step) times.push(value);
  return times;
}

type IncomingSlot = {
  weekday?: unknown;
  start?: unknown;
  end?: unknown;
  label?: unknown;
  parity?: unknown;
  kind?: unknown;
};

/**
 * Отфильтровать то, что прислал браузер.
 *
 * Битые строки молча отбрасываются, а не роняют весь запрос: потерять одну
 * пару из-за опечатки в клиенте лучше, чем не сохранить расписание целиком.
 */
export function cleanIncomingSlots(rows: unknown, limit = 400): WeeklySlot[] {
  if (!Array.isArray(rows)) return [];
  const cleaned: WeeklySlot[] = [];

  for (const raw of rows.slice(0, limit)) {
    if (typeof raw !== "object" || raw === null) continue;
    const row = raw as IncomingSlot;

    const weekday = Number(row.weekday);
    const start = Number(row.start);
    const end = Number(row.end);
    if (!Number.isInteger(weekday) || !Number.isInteger(start) || !Number.isInteger(end)) continue;
    if (weekday < 0 || weekday > 6) continue;
    if (!(start >= 0 && start < end && end <= 24 * 60)) continue;

    const parity =
      row.parity === 0 || row.parity === 1 || row.parity === "0" || row.parity === "1"
        ? Number(row.parity)
        : null;

    cleaned.push({
      weekday,
      start,
      end,
      label: String(row.label ?? "").slice(0, 60),
      parity,
      kind: String(row.kind ?? "class").slice(0, 16),
    });
  }
  return cleaned;
}
