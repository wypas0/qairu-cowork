"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { BoardPayload } from "@/lib/group";

export type PickDetail = { value: string; text: string };

/** Событие «назначить встречу на это время» — им доска говорит форме встречи. */
export const PICK_EVENT = "qairu:pick";

export type BoardLabels = {
  heatTitle: string;
  heatHint: string;
  legendNone: string;
  legendAll: string;
  windowsTitle: string;
  windowsEmpty: string;
  windowsNoData: string;
  missingShort: string;
  pick: string;
  day: string;
  duration: string;
  durationTemplate: string; // «{h} ч {m} мин» — литеральные {h} и {m}
  hoursOnlyTemplate: string; // «{h} ч»
  minutesTemplate: string; // «{m} мин»
  variantsTemplate: string; // «{n} вариантов» — литеральный {n}
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

/** Чем меньше свободных, тем темнее клетка — h0 светлее всего (свободны все), h5 темнее всего (никого). */
function heatClass(count: number, total: number): string {
  if (!total || count <= 0) return "h5";
  const share = count / total;
  if (share >= 1) return "h0";
  if (share >= 0.8) return "h1";
  if (share >= 0.6) return "h2";
  if (share >= 0.4) return "h3";
  return "h4";
}

function hhmm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function durationText(minutes: number, labels: BoardLabels): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return labels.minutesTemplate.replace("{m}", String(m));
  if (m === 0) return labels.hoursOnlyTemplate.replace("{h}", String(h));
  return labels.durationTemplate.replace("{h}", String(h)).replace("{m}", String(m));
}

/** День по умолчанию: первый, где есть хоть один вариант; иначе сегодня. */
function firstDayWithSlots(payload: BoardPayload): string {
  return (payload.slotDays.find((day) => day.items.length > 0) ?? payload.slotDays[0])?.date ?? "";
}

export function Board({
  slug,
  initial,
  dayHeaders,
  durationOptions,
  labels,
}: {
  slug: string;
  initial: BoardPayload;
  dayHeaders: { short: string; dm: string }[];
  durationOptions: number[];
  labels: BoardLabels;
}) {
  const [payload, setPayload] = useState(initial);
  const [quorum, setQuorum] = useState(initial.quorum);
  const [duration, setDuration] = useState(initial.duration);
  const [selectedDay, setSelectedDay] = useState(() => firstDayWithSlots(initial));
  const [loading, setLoading] = useState(false);
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
    async (nextQuorum: number, nextDuration: number) => {
      const id = ++requestId.current;
      setLoading(true);
      try {
        const params = new URLSearchParams({
          quorum: String(nextQuorum),
          duration: String(nextDuration),
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
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [slug],
  );

  // Ползунок двигают непрерывно — ждём паузы, иначе на каждый пиксель уходит запрос.
  useEffect(() => {
    if (quorum === initial.quorum && duration === initial.duration) return;
    const timer = setTimeout(() => void refresh(quorum, duration), 180);
    return () => clearTimeout(timer);
  }, [quorum, duration, initial.quorum, initial.duration, refresh]);

  const total = payload.total;
  const rows = payload.days[0]?.cells.length ?? 0;
  const day = payload.slotDays.find((entry) => entry.date === selectedDay) ?? payload.slotDays[0];

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
                {payload.days.map((heatDay, index) => (
                  <th key={heatDay.date}>
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
                  {payload.days.map((heatDay) => {
                    const cell = heatDay.cells[row];
                    const detail: CellDetail = {
                      date: heatDay.date,
                      dayLabel: heatDay.label,
                      start: cell.start,
                      end: cell.end,
                      count: cell.count,
                      missing: cell.missing,
                    };
                    return (
                      <td
                        key={`${heatDay.date}-${cell.start}`}
                        className={`cell ${heatClass(cell.count, total)}`}
                        title={`${cell.count}/${total}`}
                        tabIndex={0}
                        role="button"
                        aria-label={`${heatDay.label} ${hhmm(cell.start)}–${hhmm(cell.end)}: ${cell.count}/${total}`}
                        onClick={() => setActiveCell(detail)}
                        onKeyDown={(event) => {
                          if (event.key !== " " && event.key !== "Enter") return;
                          event.preventDefault();
                          setActiveCell(detail);
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
          <span>{labels.legendAll}</span>
          {["h0", "h1", "h2", "h3", "h4", "h5"].map((cls) => (
            <i key={cls} className={cls} />
          ))}
          <span>{labels.legendNone}</span>
        </div>
      </section>

      {/* ============ выбор дня и длительности ============ */}
      <section className="card" aria-busy={loading}>
        <h2>{labels.windowsTitle}</h2>

        <div className="field">
          <span className="label" id="slot-day-label">
            {labels.day}
          </span>
          <div className="daypicker" role="radiogroup" aria-labelledby="slot-day-label">
            {payload.slotDays.map((entry) => {
              const active = entry.date === day?.date;
              return (
                <button
                  key={entry.date}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={`daychip${active ? " active" : ""}${entry.items.length === 0 ? " empty" : ""}`}
                  onClick={() => setSelectedDay(entry.date)}
                  title={entry.label}
                >
                  <span>{entry.short}</span>
                  <span className="count">{entry.items.length}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="row">
          <div className="field">
            <label htmlFor="duration">{labels.duration}</label>
            <select
              id="duration"
              value={duration}
              onChange={(event) => setDuration(Number(event.target.value))}
            >
              {durationOptions.map((value) => (
                <option key={value} value={value}>
                  {durationText(value, labels)}
                </option>
              ))}
            </select>
          </div>
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
              disabled={total <= 1}
              onChange={(event) => setQuorum(Number(event.target.value))}
              style={{ width: "100%" }}
            />
          </div>
        </div>

        {day && (
          <p className="small muted" style={{ margin: "2px 0 6px" }}>
            {day.label} ·{" "}
            {labels.variantsTemplate.replace("{n}", String(day.items.length))} ·{" "}
            {durationText(payload.duration, labels)}
          </p>
        )}

        <div className="slotlist">
          {total === 0 ? (
            <p className="muted small">{labels.windowsNoData}</p>
          ) : !day || day.items.length === 0 ? (
            <p className="muted small">{labels.windowsEmpty}</p>
          ) : (
            <ul className="windows">
              {day.items.map((item) => (
                <li key={`${day.date}-${item.start}`} className="slotrow">
                  <div className="slotinfo">
                    <span className="when">{item.text}</span>{" "}
                    <span className="small muted">
                      {item.count}/{total}
                      {item.missing.length > 0 &&
                        ` — ${labels.missingShort} ${item.missing.join(", ")}`}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() =>
                      pick(day.date, item.start, item.end, `${day.label} · ${item.text}`)
                    }
                  >
                    {labels.pick}
                  </button>
                </li>
              ))}
            </ul>
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
