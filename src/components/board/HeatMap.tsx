"use client";

import { useEffect, useRef, useState } from "react";

import { fmtMinutes } from "@/core/intervals";
import type { BoardPayload } from "@/lib/group";
import { IconChevronLeft, IconChevronRight, IconMeeting } from "../icons";
import { BreakRow, PeriodTime } from "../PeriodRow";
import type { CellDetail, Hover } from "./CellDetails";
import { useDragSelect } from "./hooks";
import type { BoardLabels } from "./labels";
import { MAX_WEEK, type WallNow, heatClass } from "./time";

type Pick = (date: string, start: number, end: number, text: string) => void;

/**
 * Карта недели. На широком экране — таблица «пары × дни»: наведение
 * показывает, кто свободен, протяжка мышью по дню ставит время в форму
 * встречи. На телефоне семь узких столбцов не читаются, поэтому там один
 * день крупными строками: у каждой пары сразу видно, кого не хватает, а дни
 * листаются чипами или свайпом.
 */
export function HeatMap({
  payload,
  week,
  onWeek,
  now,
  spot,
  loading,
  labels,
  onHover,
  onOpen,
  onPick,
}: {
  payload: BoardPayload;
  week: number;
  onWeek: (week: number) => void;
  now: WallNow | null;
  spot: number | null;
  loading: boolean;
  labels: BoardLabels;
  onHover: (hover: Hover | null) => void;
  onOpen: (detail: CellDetail) => void;
  onPick: Pick;
}) {
  const total = payload.total;
  const today = now?.day ?? payload.today;
  const [allRows, setAllRows] = useState(false);

  const select = useDragSelect(({ date, start, end }) => {
    const label = payload.days.find((entry) => entry.date === date)?.label ?? date;
    onPick(date, start, end, `${label} · ${fmtMinutes(start)}–${fmtMinutes(end)}`);
  });

  // Встречи приходят вместе с остальными данными доски: иначе при переходе
  // на следующую неделю на карте остались бы встречи текущей.
  const meetingsAt = (date: string, start: number, end: number) =>
    payload.meetings.filter((meeting) => meeting.date === date && meeting.start < end && start < meeting.end);

  // Ряды по краям дня, где не свободен никто и нет встреч, прячем: ранним
  // утром и поздним вечером карта иначе состоит из одинаковых пустых клеток.
  const rowUsed = (row: number) =>
    payload.days.some(
      (heatDay) =>
        heatDay.cells[row].count > 0 ||
        meetingsAt(heatDay.date, heatDay.cells[row].start, heatDay.cells[row].end).length > 0,
    );
  const lastRow = payload.periods.length - 1;
  let firstShown = 0;
  let lastShown = lastRow;
  if (total > 0) {
    while (firstShown < lastShown && !rowUsed(firstShown)) firstShown += 1;
    while (lastShown > firstShown && !rowUsed(lastShown)) lastShown -= 1;
  }
  const trimmable = firstShown > 0 || lastShown < lastRow;
  if (allRows) {
    firstShown = 0;
    lastShown = lastRow;
  }
  const shownRows = payload.periods
    .map((period, row) => ({ period, row }))
    .filter(({ row }) => row >= firstShown && row <= lastShown);

  /** Всё о клетке: для подсказки, окна по нажатию и классов. */
  function describe(heatDay: BoardPayload["days"][number], row: number) {
    const cell = heatDay.cells[row];
    const here = meetingsAt(heatDay.date, cell.start, cell.end);
    const detail: CellDetail = {
      date: heatDay.date,
      dayLabel: heatDay.label,
      start: cell.start,
      end: cell.end,
      count: cell.count,
      free: cell.free,
      soft: cell.soft,
      missing: cell.missing,
      meetings: here.map((meeting) => meeting.title),
    };
    const past = now !== null && (heatDay.date < now.day || (heatDay.date === now.day && cell.end <= now.min));
    const current = now !== null && heatDay.date === now.day && cell.start <= now.min && now.min < cell.end;
    return { cell, here, detail, past, current };
  }

  // ---------- телефон: один день ----------
  const defaultDay = () =>
    payload.days.some((entry) => entry.date === today) ? today : (payload.days[0]?.date ?? "");
  const [mobileDay, setMobileDay] = useState(defaultDay);
  const weekKey = payload.days[0]?.date;
  useEffect(() => {
    // Новая неделя — показываем её первый день (или сегодня, если он в ней).
    setMobileDay(defaultDay());
    // defaultDay читает только payload и today, а меняется неделя — по её первому дню.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekKey]);
  const dayIndex = Math.max(
    0,
    payload.days.findIndex((entry) => entry.date === mobileDay),
  );
  const heatDay = payload.days[dayIndex];
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const stepDay = (delta: number) => {
    const next = payload.days[dayIndex + delta];
    if (next) setMobileDay(next.date);
  };

  return (
    <section className="card heatmap" aria-busy={loading}>
      <div className="card-head">
        <h2>{labels.heatTitle}</h2>
        <div className="weeknav">
          <button
            type="button"
            className="btn btn-sm btn-quiet"
            aria-label={labels.weekPrev}
            disabled={week === 0}
            onClick={() => onWeek(Math.max(0, week - 1))}
          >
            <IconChevronLeft size={18} />
          </button>
          <span className="small">{payload.weekLabel}</span>
          <button
            type="button"
            className="btn btn-sm btn-quiet"
            aria-label={labels.weekNext}
            disabled={week >= MAX_WEEK}
            onClick={() => onWeek(Math.min(MAX_WEEK, week + 1))}
          >
            <IconChevronRight size={18} />
          </button>
          {week > 0 && (
            <button type="button" className="btn btn-sm" onClick={() => onWeek(0)}>
              {labels.weekThis}
            </button>
          )}
        </div>
      </div>
      <p className="small muted heat-desktop">{labels.heatHint}</p>
      <p className="small muted heat-mobile">{labels.heatHintMobile}</p>

      {/* ============ широкий экран: вся неделя ============ */}
      <div className="gridwrap heat-desktop">
        <table className={`week periods${select.drag ? " dragging" : ""}${spot !== null ? " spotting" : ""}`}>
          <thead>
            <tr>
              <th className="timecol" />
              {payload.days.map((entry) => (
                <th
                  key={entry.date}
                  className={entry.date === today ? "today" : undefined}
                  aria-current={entry.date === today ? "date" : undefined}
                >
                  {entry.short}
                  <br />
                  <span className="small muted">{entry.dm}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shownRows.map(({ period, row }) => [
              // Перерыв перед первым показанным рядом не нужен: над ним ничего нет.
              row === firstShown ? null : (
                <BreakRow
                  key={`break-${period.start}`}
                  period={period}
                  columns={payload.days.length}
                  template={labels.breakRow}
                />
              ),
              <tr key={period.start}>
                <PeriodTime period={period} />
                {payload.days.map((entry) => {
                  const { cell, here, detail, past, current } = describe(entry, row);
                  // Подпись — только в первой клетке встречи за день, дальше просто красные.
                  const titled = here.filter(
                    (meeting) =>
                      row === firstShown ||
                      !(meeting.start < entry.cells[row - 1].end && entry.cells[row - 1].start < meeting.end),
                  );
                  const drag = select.drag;
                  const inRange =
                    drag !== null &&
                    drag.date === entry.date &&
                    row >= Math.min(drag.from, drag.to) &&
                    row <= Math.max(drag.from, drag.to);
                  const classes = [
                    "cell",
                    here.length > 0 ? "meeting" : heatClass(cell.count, total),
                    cell.mine ? "mine" : "",
                    past ? "past" : "",
                    inRange ? "inrange" : "",
                    spot === null ? "" : cell.freeIds.includes(spot) ? "spot-on" : "spot-off",
                  ];
                  return (
                    <td
                      key={`${entry.date}-${cell.start}`}
                      className={classes.filter(Boolean).join(" ")}
                      onPointerDown={(event) => {
                        if (event.pointerType !== "mouse" || event.button !== 0) return;
                        select.start(entry.date, { row, start: cell.start, end: cell.end });
                      }}
                      onPointerEnter={(event) => {
                        // Подсказка — для мыши; на телефоне то же показывает окно по нажатию.
                        if (event.pointerType !== "mouse") return;
                        if (select.dragging()) {
                          onHover(null);
                          select.extend(entry.date, { row, start: cell.start, end: cell.end });
                          return;
                        }
                        const rect = event.currentTarget.getBoundingClientRect();
                        const below = rect.top < 140;
                        onHover({ detail, x: rect.left + rect.width / 2, y: below ? rect.bottom : rect.top, below });
                      }}
                      onPointerLeave={() => onHover(null)}
                      tabIndex={0}
                      role="button"
                      aria-label={cellLabel(detail, total, labels)}
                      onClick={() => {
                        if (select.shouldSkipClick()) return;
                        onHover(null);
                        onOpen(detail);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== " " && event.key !== "Enter") return;
                        event.preventDefault();
                        onOpen(detail);
                      }}
                    >
                      {titled.length > 0 && <span className="cell-meeting">{titled[0].title}</span>}
                      {cell.soft.length > 0 && here.length === 0 && <span className="soft-mark" aria-hidden="true" />}
                      {current && now && (
                        <span
                          className="now-line"
                          style={{ top: `${((now.min - cell.start) / (cell.end - cell.start)) * 100}%` }}
                          title={labels.nowLabel}
                          aria-hidden="true"
                        />
                      )}
                    </td>
                  );
                })}
              </tr>,
            ])}
          </tbody>
        </table>
      </div>

      {/* ============ телефон: один день ============ */}
      {heatDay && (
        <div className="heat-mobile">
          <div className="heat-days" role="tablist" aria-label={labels.day}>
            {payload.days.map((entry) => (
              <button
                key={entry.date}
                type="button"
                role="tab"
                aria-selected={entry.date === heatDay.date}
                className={`daychip${entry.date === heatDay.date ? " active" : ""}${entry.date === today ? " today" : ""}`}
                onClick={() => setMobileDay(entry.date)}
              >
                <span>{entry.short}</span>
                <span className="daychip-date">{entry.dm}</span>
              </button>
            ))}
          </div>
          <ul
            className="agenda"
            onTouchStart={(event) => {
              const touch = event.touches[0];
              swipe.current = { x: touch.clientX, y: touch.clientY };
            }}
            onTouchEnd={(event) => {
              const start = swipe.current;
              swipe.current = null;
              if (!start) return;
              const touch = event.changedTouches[0];
              const dx = touch.clientX - start.x;
              const dy = touch.clientY - start.y;
              // Свайп — заметно по горизонтали и почти без вертикали, иначе это прокрутка.
              if (Math.abs(dx) > 60 && Math.abs(dy) < 40) stepDay(dx < 0 ? 1 : -1);
            }}
          >
            {shownRows.map(({ period, row }) => {
              const { cell, here, detail, past, current } = describe(heatDay, row);
              const tone = here.length > 0 ? "meeting" : heatClass(cell.count, total);
              const who =
                here.length > 0
                  ? here.map((meeting) => meeting.title).join(", ")
                  : cell.missing.length === 0
                    ? labels.bestAll
                    : `${labels.missingShort} ${cell.missing.join(", ")}`;
              return (
                <li key={period.start}>
                  <button
                    type="button"
                    className={`agenda-row${past ? " past" : ""}${current ? " current" : ""}`}
                    aria-label={cellLabel(detail, total, labels)}
                    onClick={() => onOpen(detail)}
                  >
                    <span className="agenda-time">
                      {period.n > 0 && <b>{period.n}</b>}
                      {fmtMinutes(period.start)}–{fmtMinutes(period.end)}
                    </span>
                    {/* Цвет — только у счётчика: текст на шкале читался бы не на всех ступенях. */}
                    <span className={`agenda-count ${tone}${cell.mine ? " mine" : ""}`}>
                      {here.length > 0 ? <IconMeeting size={18} /> : `${cell.count}/${total}`}
                    </span>
                    <span className="agenda-text">
                      <span className="agenda-who">{who}</span>
                      {cell.soft.length > 0 && here.length === 0 && (
                        <span className="agenda-soft">{labels.softNames.replace("{names}", cell.soft.join(", "))}</span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {trimmable && (
        <p className="rows-note small muted">
          {allRows ? null : <span>{labels.rowsTrimmed}</span>}
          <button type="button" className="btn btn-sm btn-quiet" onClick={() => setAllRows((value) => !value)}>
            {allRows ? labels.rowsHideEmpty : labels.rowsShowAll}
          </button>
        </p>
      )}

      <div className="legend">
        <span>{labels.legendAll}</span>
        <span className="legend-scale" aria-hidden="true">
          {["h0", "h1", "h2", "h3", "h4", "h5"].map((cls) => (
            <i key={cls} className={cls} />
          ))}
        </span>
        <span>{labels.legendNone}</span>
        <span className="legend-item">
          <i className="swatch-meeting" />
          {labels.legendMeeting}
        </span>
        <span className="legend-item">
          <i className="swatch-mine" />
          {labels.legendMine}
        </span>
        <span className="legend-item">
          <i className="swatch-soft" />
          {labels.legendSoft}
        </span>
      </div>
    </section>
  );
}

/** Подпись клетки для скринридера: день, время, сколько свободно, встречи. */
function cellLabel(detail: CellDetail, total: number, labels: BoardLabels): string {
  const meetings = detail.meetings.length > 0 ? ` · ${labels.legendMeeting}: ${detail.meetings.join(", ")}` : "";
  return `${detail.dayLabel} ${fmtMinutes(detail.start)}–${fmtMinutes(detail.end)}: ${detail.count}/${total}${meetings}`;
}
