import type { Period } from "@/core/grid";
import { BREAK_ROW_MIN } from "@/core/grid";
import { fmtMinutes } from "@/core/intervals";

/**
 * Ячейка времени слева: номер пары и начало в первой строке, конец — второй,
 * приглушённо. Три строки (номер, начало, конец) раздували каждый ряд карты
 * выше клетки.
 */
export function PeriodTime({ period }: { period: Period }) {
  return (
    <td className="timecol period">
      <span className="period-line">
        {period.n > 0 && <b className="period-n">{period.n}</b>}
        <span className="period-start">{fmtMinutes(period.start)}</span>
      </span>
      <span className="period-end">{fmtMinutes(period.end)}</span>
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
