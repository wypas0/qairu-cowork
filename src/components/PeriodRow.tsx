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

/**
 * Подпись ряда-перерыва на карте группы: одно слово, чтобы ряд оставался
 * узким; длительность и время — в подсказке.
 */
export function PauseTime({ period, label, template }: { period: Period; label: string; template: string }) {
  const full = `${template.replace("{m}", String(period.end - period.start))} · ${fmtMinutes(period.start)}–${fmtMinutes(period.end)}`;
  return (
    <td className="timecol pause-label" title={full}>
      {label}
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
