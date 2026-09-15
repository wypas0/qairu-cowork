import type { Period } from "@/core/grid";
import { BREAK_ROW_MIN } from "@/core/grid";

export function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** Ячейка времени слева: номер пары и её начало–конец, как на портале. */
export function PeriodTime({ period }: { period: Period }) {
  return (
    <td className="timecol period">
      {period.n > 0 && <b className="period-n">{period.n}</b>}
      <span className="period-time">
        {hhmm(period.start)} –<br />
        {hhmm(period.end)}
      </span>
    </td>
  );
}

/** Строка «Перерыв 20 мин» перед рядом, если перерыв перед ним длинный. */
export function BreakRow({ period, columns, template }: { period: Period; columns: number; template: string }) {
  if (period.breakBefore < BREAK_ROW_MIN) return null;
  return (
    <tr className="break-row">
      <td colSpan={columns + 1}>{template.replace("{m}", String(period.breakBefore))}</td>
    </tr>
  );
}
