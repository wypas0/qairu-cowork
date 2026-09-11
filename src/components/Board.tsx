"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { BoardPayload } from "@/lib/group";

export type PickDetail = { value: string; text: string };

/** Событие «назначить встречу на это окно» — им доска говорит форме встречи. */
export const PICK_EVENT = "qairu:pick";

export type BoardLabels = {
  heatTitle: string;
  heatHint: string;
  legendNone: string;
  legendAll: string;
  windowsTitle: string;
  windowsEmpty: string;
  missingShort: string;
  pick: string;
  minSlot: string;
  minutesShort: string;
  quorumTemplate: string;
  close: string;
};

type CellDetail = {
  date: string;
  dayLabel: string;
  start: number;
  end: number;
  count: number;
  missing: string[];
};

function heatClass(count: number, total: number): string {
  if (!total || count <= 0) return "h0";
  const share = count / total;
  if (share >= 1) return "h5";
  if (share >= 0.8) return "h4";
  if (share >= 0.6) return "h3";
  if (share >= 0.4) return "h2";
  return "h1";
}

function hhmm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const MIN_SLOT_OPTIONS = [30, 45, 60, 90, 120];

export function Board({
  slug,
  initial,
  dayHeaders,
  initialQuorum,
  initialMinSlot,
  labels,
}: {
  slug: string;
  initial: BoardPayload;
  dayHeaders: { short: string; dm: string }[];
  initialQuorum: number;
  initialMinSlot: number;
  labels: BoardLabels;
}) {
  const [payload, setPayload] = useState(initial);
  const [quorum, setQuorum] = useState(initialQuorum);
  const [minSlot, setMinSlot] = useState(initialMinSlot);
  const [activeCell, setActiveCell] = useState<CellDetail | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    if (!activeCell) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setActiveCell(null);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [activeCell]);

  const refresh = useCallback(
    async (nextQuorum: number, nextMinSlot: number) => {
      const id = ++requestId.current;
      try {
        const params = new URLSearchParams({
          quorum: String(nextQuorum),
          min: String(nextMinSlot),
        });
        const response = await fetch(`/api/g/${slug}/state?${params}`, {
          credentials: "same-origin",
        });
        if (!response.ok) return;
        const data = (await response.json()) as BoardPayload;
        // Ответы могут прийти не в том порядке, в каком уехали запросы.
        if (id === requestId.current) setPayload(data);
      } catch {
        // При сетевой ошибке просто оставляем прежнюю картинку.
      }
    },
    [slug],
  );

  // Ползунок двигают непрерывно — ждём паузы, иначе на каждый пиксель уходит запрос.
  useEffect(() => {
    if (quorum === initialQuorum && minSlot === initialMinSlot) return;
    const timer = setTimeout(() => void refresh(quorum, minSlot), 180);
    return () => clearTimeout(timer);
  }, [quorum, minSlot, initialQuorum, initialMinSlot, refresh]);

  const total = payload.total;
  const rows = payload.days[0]?.cells.length ?? 0;

  function pick(date: string, start: number, end: number, text: string) {
    const detail: PickDetail = { value: `${date}T${hhmm(start)}|${end - start}`, text };
    window.dispatchEvent(new CustomEvent<PickDetail>(PICK_EVENT, { detail }));
  }

  return (
    <div className="grid-2">
      {/* ============ тепловая карта недели ============ */}
      <section className="card">
        <h2>{labels.heatTitle}</h2>
        <p className="small muted">{labels.heatHint}</p>

        <div className="gridwrap">
          <table className="week">
            <thead>
              <tr>
                <th className="timecol" />
                {payload.days.map((day, index) => (
                  <th key={day.date}>
                    {dayHeaders[index]?.short}
                    <br />
                    <span className="small muted">{dayHeaders[index]?.dm}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: rows }, (_, row) => (
                <tr key={row}>
                  <td className="timecol">
                    {row % 2 === 0 ? hhmm(payload.days[0].cells[row].start) : ""}
                  </td>
                  {payload.days.map((day) => {
                    const cell = day.cells[row];
                    return (
                      <td
                        key={`${day.date}-${cell.start}`}
                        className={`cell ${heatClass(cell.count, total)}`}
                        title={`${cell.count}/${total}`}
                        tabIndex={0}
                        role="button"
                        aria-label={`${day.label} ${hhmm(cell.start)}–${hhmm(cell.end)}: ${cell.count}/${total}`}
                        onClick={() =>
                          setActiveCell({
                            date: day.date,
                            dayLabel: day.label,
                            start: cell.start,
                            end: cell.end,
                            count: cell.count,
                            missing: cell.missing,
                          })
                        }
                        onKeyDown={(event) => {
                          if (event.key !== " " && event.key !== "Enter") return;
                          event.preventDefault();
                          setActiveCell({
                            date: day.date,
                            dayLabel: day.label,
                            start: cell.start,
                            end: cell.end,
                            count: cell.count,
                            missing: cell.missing,
                          });
                        }}
                      />
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="legend">
          <span>{labels.legendNone}</span>
          {["h0", "h1", "h2", "h3", "h4", "h5"].map((cls) => (
            <i key={cls} className={cls} />
          ))}
          <span>{labels.legendAll}</span>
        </div>
      </section>

      {/* ============ окна и фильтры ============ */}
      <section className="card">
        <h2>{labels.windowsTitle}</h2>

        <div className="field">
          <label htmlFor="quorum">
            {labels.quorumTemplate
              .replace("{q}", String(payload.quorum))
              .replace("{n}", String(total))}
          </label>
          <input
            id="quorum"
            type="range"
            min={1}
            max={Math.max(1, total)}
            value={Math.min(quorum, Math.max(1, total))}
            onChange={(event) => setQuorum(Number(event.target.value))}
            style={{ width: "100%" }}
          />
        </div>

        <div className="field">
          <label htmlFor="minslot">{labels.minSlot}</label>
          <select
            id="minslot"
            value={minSlot}
            onChange={(event) => setMinSlot(Number(event.target.value))}
          >
            {MIN_SLOT_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value} {labels.minutesShort}
              </option>
            ))}
          </select>
        </div>

        <div>
          {payload.windows.length === 0 ? (
            <p className="muted small">{labels.windowsEmpty}</p>
          ) : (
            payload.windows.map((day) => (
              <div className="daygroup" key={day.date}>
                <h3>{day.label}</h3>
                <ul className="windows">
                  {day.items.map((item) => (
                    <li key={`${day.date}-${item.start}`}>
                      <span className="when">{item.text}</span>{" "}
                      {!payload.everyone && (
                        <span className="small muted">
                          {item.count}/{total}
                          {item.missing.length > 0 &&
                            ` — ${labels.missingShort} ${item.missing.join(", ")}`}
                        </span>
                      )}{" "}
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => pick(day.date, item.start, item.end, item.text)}
                      >
                        {labels.pick}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      </section>

      {activeCell && (
        <div className="cell-popover-overlay" onClick={() => setActiveCell(null)}>
          <div
            className="cell-popover"
            role="dialog"
            aria-modal="true"
            aria-label={`${activeCell.dayLabel} ${hhmm(activeCell.start)}–${hhmm(activeCell.end)}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="profile-head">
              <h3 style={{ margin: 0 }}>{activeCell.dayLabel}</h3>
              <button
                type="button"
                className="btn btn-sm btn-quiet"
                onClick={() => setActiveCell(null)}
              >
                {labels.close}
              </button>
            </div>
            <p className="when" style={{ fontSize: 16 }}>
              {hhmm(activeCell.start)}–{hhmm(activeCell.end)}
            </p>
            <p className="small muted">
              {activeCell.count}/{total}
              {activeCell.missing.length > 0 &&
                ` — ${labels.missingShort} ${activeCell.missing.join(", ")}`}
            </p>
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: "100%", marginTop: 8 }}
              onClick={() => {
                pick(
                  activeCell.date,
                  activeCell.start,
                  activeCell.end,
                  `${activeCell.dayLabel} · ${hhmm(activeCell.start)}–${hhmm(activeCell.end)}`,
                );
                setActiveCell(null);
              }}
            >
              {labels.pick}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
