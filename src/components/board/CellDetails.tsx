"use client";

import { fmtMinutes } from "@/core/intervals";
import { IconMeeting } from "../icons";
import type { BoardLabels } from "./labels";

/** Всё, что показывают о клетке карты: подсказка при наведении и окно по нажатию. */
export type CellDetail = {
  date: string;
  dayLabel: string;
  start: number;
  end: number;
  count: number;
  free: string[];
  /** Свободны, но им это время неудобно. */
  soft: string[];
  missing: string[];
  meetings: string[];
};

/** Где показать подсказку: над клеткой, а у верхнего края экрана — под ней. */
export type Hover = { detail: CellDetail; x: number; y: number; below: boolean };

/**
 * Кто свободен и кто занят в клетке — таблица в две колонки. Свободные — на
 * ярко-голубых плашках, занятые — на тёмно-синих: колонку видно, не читая
 * заголовок. Кому время неудобно, у того плашка с пунктиром и строка ниже.
 */
export function WhoIsFree({ detail, total, labels }: { detail: CellDetail; total: number; labels: BoardLabels }) {
  const rows = Math.max(detail.free.length, detail.missing.length, 1);
  return (
    <>
      <table className="who-table">
        <thead>
          <tr>
            <th scope="col">
              {labels.freeNames} <span className="who-count">{detail.count}/{total}</span>
            </th>
            <th scope="col">
              {labels.busyNames} <span className="who-count">{detail.missing.length}/{total}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, index) => {
            const free = detail.free[index];
            const busy = detail.missing[index];
            return (
              <tr key={index}>
                <td>
                  {free ? (
                    <span className={`who-pill free${detail.soft.includes(free) ? " soft" : ""}`}>{free}</span>
                  ) : index === 0 ? (
                    <span className="who-none">{labels.nobody}</span>
                  ) : null}
                </td>
                <td>
                  {busy ? (
                    <span className="who-pill busy">{busy}</span>
                  ) : index === 0 ? (
                    <span className="who-none">—</span>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {detail.soft.length > 0 && (
        <p className="who-soft">{labels.softNames.replace("{names}", detail.soft.join(", "))}</p>
      )}
    </>
  );
}

/** Подсказка при наведении мышью — у клетки, без щелчка. */
export function CellTooltip({ hover, total, labels }: { hover: Hover; total: number; labels: BoardLabels }) {
  const { detail } = hover;
  return (
    <div
      className={`cell-tooltip${hover.below ? " below" : ""}`}
      role="tooltip"
      style={{ left: hover.x, top: hover.y }}
    >
      <div className="cell-tooltip-head">
        {detail.dayLabel} · {fmtMinutes(detail.start)}–{fmtMinutes(detail.end)}
      </div>
      {detail.meetings.map((title, index) => (
        <div key={index} className="cell-popover-meeting">
          <IconMeeting /> {title}
        </div>
      ))}
      <WhoIsFree detail={detail} total={total} labels={labels} />
    </div>
  );
}

/** Окно клетки по нажатию — на телефоне это единственный способ увидеть, кто свободен. */
export function CellPopover({
  detail,
  total,
  labels,
  onClose,
  onPick,
}: {
  detail: CellDetail;
  total: number;
  labels: BoardLabels;
  onClose: () => void;
  onPick: () => void;
}) {
  return (
    <div className="cell-popover-overlay" onClick={onClose}>
      <div
        className="cell-popover"
        role="dialog"
        aria-modal="true"
        aria-label={`${detail.dayLabel} ${fmtMinutes(detail.start)}–${fmtMinutes(detail.end)}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="profile-head">
          <h3 style={{ margin: 0 }}>{detail.dayLabel}</h3>
          <button type="button" className="btn btn-sm btn-quiet" onClick={onClose}>
            {labels.close}
          </button>
        </div>
        <p className="when" style={{ fontSize: 16 }}>
          {fmtMinutes(detail.start)}–{fmtMinutes(detail.end)}
        </p>
        {detail.meetings.map((title, index) => (
          <p key={index} className="cell-popover-meeting">
            <IconMeeting /> {title}
          </p>
        ))}
        <WhoIsFree detail={detail} total={total} labels={labels} />
        <button type="button" className="btn btn-primary" style={{ width: "100%", marginTop: 8 }} onClick={onPick}>
          {labels.pick}
        </button>
      </div>
    </div>
  );
}
