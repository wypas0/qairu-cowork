"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { BoardPayload } from "@/lib/group";
import { IconChevronLeft, IconChevronRight, IconMeeting } from "./icons";
import { BreakRow, PeriodTime, hhmm } from "./PeriodRow";

export type PickDetail = { value: string; text: string };

/** Событие «назначить встречу на это время» — им доска говорит форме встречи. */
export const PICK_EVENT = "qairu:pick";

export type BoardLabels = {
  bestTitle: string;
  bestLead: string;
  bestEmpty: string;
  bestAll: string;
  bestCount: string; // «свободны {n} из {total}»
  weekPrev: string;
  weekNext: string;
  weekThis: string;
  whoNeeded: string; // «Кто должен прийти · {n} из {total}»
  whoAll: string;
  whoHint: string;
  notFilled: string;
  heatTitle: string;
  heatHint: string;
  breakRow: string; // «Перерыв {m} мин»
  legendNone: string;
  legendAll: string;
  legendMeeting: string;
  legendMine: string;
  freeNames: string;
  busyNames: string;
  nobody: string;
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
  close: string;
};

type CellDetail = {
  date: string;
  dayLabel: string;
  start: number;
  end: number;
  count: number;
  free: string[];
  missing: string[];
  meetings: string[];
};

/** Где показать подсказку: над клеткой, а у верхнего края экрана — под ней. */
type Hover = { detail: CellDetail; x: number; y: number; below: boolean };

/** h0 — свободны все (самая насыщенная клетка), h5 — никого (почти фон): сильнее цвет — полезнее окно. */
function heatClass(count: number, total: number): string {
  if (!total || count <= 0) return "h5";
  const share = count / total;
  if (share >= 1) return "h0";
  if (share >= 0.8) return "h1";
  if (share >= 0.6) return "h2";
  if (share >= 0.4) return "h3";
  return "h4";
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
  durationOptions,
  labels,
}: {
  slug: string;
  initial: BoardPayload;
  durationOptions: number[];
  labels: BoardLabels;
}) {
  const [payload, setPayload] = useState(initial);
  // Кто должен прийти. null — все, у кого есть расписание.
  const [selected, setSelected] = useState<number[] | null>(initial.selected);
  const [duration, setDuration] = useState(initial.duration);
  const [week, setWeek] = useState(initial.week);
  const [selectedDay, setSelectedDay] = useState(() => firstDayWithSlots(initial));
  const [loading, setLoading] = useState(false);
  const [activeCell, setActiveCell] = useState<CellDetail | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const requestId = useRef(0);
  // Для каких кворума и длительности посчитаны данные, что сейчас на экране.
  // Сравнивать выбор нужно с ними, а не с начальными значениями: иначе
  // 60 → 90 → 60 не перезапрашивало данные, и под «1 ч» оставались
  // 90-минутные варианты.
  const loaded = useRef({
    selected: selectionKey(initial.selected),
    duration: initial.duration,
    week: initial.week,
  });

  useEffect(() => {
    if (!activeCell) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setActiveCell(null);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [activeCell]);

  // Подсказка привязана к месту на экране — при прокрутке она бы уехала от клетки.
  useEffect(() => {
    if (!hover) return;
    const hide = () => setHover(null);
    window.addEventListener("scroll", hide, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", hide, { capture: true });
  }, [hover]);

  const refresh = useCallback(
    async (nextSelected: number[] | null, nextDuration: number, nextWeek: number) => {
      const id = ++requestId.current;
      setLoading(true);
      try {
        const params = new URLSearchParams({
          duration: String(nextDuration),
          week: String(nextWeek),
        });
        if (nextSelected) params.set("members", nextSelected.join(","));
        const response = await fetch(`/api/g/${slug}/state?${params}`, {
          credentials: "same-origin",
        });
        if (!response.ok) return;
        const data = (await response.json()) as BoardPayload;
        // Ответы могут прийти не в том порядке, в каком уехали запросы.
        if (id === requestId.current) {
          loaded.current = {
            selected: selectionKey(nextSelected),
            duration: nextDuration,
            week: nextWeek,
          };
          setPayload(data);
          // День для списка окон принадлежал прошлой неделе — берём первый с вариантами.
          setSelectedDay((current) =>
            data.slotDays.some((entry) => entry.date === current) ? current : firstDayWithSlots(data),
          );
        }
      } catch {
        // При сетевой ошибке просто оставляем прежнюю картинку.
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [slug],
  );

  // Галочки щёлкают подряд — ждём паузы, иначе на каждый щелчок уходит запрос.
  useEffect(() => {
    if (
      selectionKey(selected) === loaded.current.selected &&
      duration === loaded.current.duration &&
      week === loaded.current.week
    ) {
      // Вернулись к тому, что уже на экране: запрос, отправленный за
      // промежуточным выбором, не должен затем подменить эти данные.
      requestId.current += 1;
      setLoading(false);
      return;
    }
    const timer = setTimeout(() => void refresh(selected, duration, week), 180);
    return () => clearTimeout(timer);
  }, [selected, duration, week, refresh]);

  const total = payload.total;
  // Встречи приходят вместе с остальными данными доски: иначе при переходе
  // на следующую неделю на карте остались бы встречи текущей.
  const meetings = payload.meetings;
  const meetingsAt = (date: string, start: number, end: number) =>
    meetings.filter((meeting) => meeting.date === date && meeting.start < end && start < meeting.end);

  const day = payload.slotDays.find((entry) => entry.date === selectedDay) ?? payload.slotDays[0];

  // Список «кто должен прийти»: считать окна можно не для всех, а для тех,
  // без кого встреча не имеет смысла. Не заполнившие расписание в расчёт
  // не попадают — про них неизвестно, свободны ли они.
  const filledIds = payload.people.filter((person) => person.filled).map((person) => person.id);
  const isOn = (id: number) => (selected === null ? filledIds.includes(id) : selected.includes(id));
  const chosenCount = selected === null ? filledIds.length : selected.length;

  function togglePerson(id: number) {
    const current = selected ?? filledIds;
    const next = current.includes(id) ? current.filter((other) => other !== id) : [...current, id];
    // Хотя бы один человек должен остаться — иначе считать нечего.
    if (next.length === 0) return;
    setSelected(next.length === filledIds.length ? null : next);
  }

  function pick(date: string, start: number, end: number, text: string) {
    const detail: PickDetail = { value: `${date}T${hhmm(start)}|${end - start}`, text };
    window.dispatchEvent(new CustomEvent<PickDetail>(PICK_EVENT, { detail }));
  }

  return (
    <>
      {/* ============ главный ответ страницы ============ */}
      <section className="card" aria-busy={loading}>
        <h2>{labels.bestTitle}</h2>
        <p className="small muted">{labels.bestLead}</p>
        {payload.best.length === 0 ? (
          <div className="empty">
            <h3>{labels.bestEmpty}</h3>
          </div>
        ) : (
          <ul className="best-list">
            {payload.best.map((item) => (
              <li className="best-item" key={`${item.date}-${item.start}`}>
                <div className="best-when">
                  <span className="type-title-3">{item.text}</span>
                  <span className="small muted">{item.short}</span>
                </div>
                <p className="small muted best-who">
                  {item.missing.length === 0
                    ? labels.bestAll
                    : `${labels.bestCount
                        .replace("{n}", String(item.count))
                        .replace("{total}", String(payload.selectedTotal))} — ${labels.missingShort} ${item.missing.join(", ")}`}
                </p>
                <button
                  type="button"
                  className="btn"
                  onClick={() => pick(item.date, item.start, item.end, `${item.label} · ${item.text}`)}
                >
                  {labels.pick}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid-2">
      {/* ============ тепловая карта недели ============ */}
      <section className="card" aria-busy={loading}>
        <div className="card-head">
          <h2>{labels.heatTitle}</h2>
          <div className="weeknav">
            <button
              type="button"
              className="btn btn-sm btn-quiet"
              aria-label={labels.weekPrev}
              disabled={week === 0}
              onClick={() => setWeek((current) => Math.max(0, current - 1))}
            >
              <IconChevronLeft size={18} />
            </button>
            <span className="small">{payload.weekLabel}</span>
            <button
              type="button"
              className="btn btn-sm btn-quiet"
              aria-label={labels.weekNext}
              disabled={week >= MAX_WEEK}
              onClick={() => setWeek((current) => Math.min(MAX_WEEK, current + 1))}
            >
              <IconChevronRight size={18} />
            </button>
            {week > 0 && (
              <button type="button" className="btn btn-sm" onClick={() => setWeek(0)}>
                {labels.weekThis}
              </button>
            )}
          </div>
        </div>
        <p className="small muted">{labels.heatHint}</p>

        <div className="gridwrap">
          <table className="week periods">
            <thead>
              <tr>
                <th className="timecol" />
                {payload.days.map((heatDay) => (
                  <th key={heatDay.date}>
                    {heatDay.short}
                    <br />
                    <span className="small muted">{heatDay.dm}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {payload.periods.map((period, row) => [
                <BreakRow
                  key={`break-${period.start}`}
                  period={period}
                  columns={payload.days.length}
                  template={labels.breakRow}
                />,
                <tr key={period.start}>
                  <PeriodTime period={period} />
                  {payload.days.map((heatDay) => {
                    const cell = heatDay.cells[row];
                    const here = meetingsAt(heatDay.date, cell.start, cell.end);
                    // Подпись — только в первой клетке встречи за день, дальше просто красные.
                    const titled = here.filter(
                      (meeting) => row === 0 || !(meeting.start < heatDay.cells[row - 1].end && heatDay.cells[row - 1].start < meeting.end),
                    );
                    const detail: CellDetail = {
                      date: heatDay.date,
                      dayLabel: heatDay.label,
                      start: cell.start,
                      end: cell.end,
                      count: cell.count,
                      free: cell.free,
                      missing: cell.missing,
                      meetings: here.map((meeting) => meeting.title),
                    };
                    return (
                      <td
                        key={`${heatDay.date}-${cell.start}`}
                        className={`cell ${here.length > 0 ? "meeting" : heatClass(cell.count, total)}${
                          cell.mine ? " mine" : ""
                        }`}
                        onPointerEnter={(event) => {
                          // Подсказка — для мыши; на телефоне то же самое показывает окно по нажатию.
                          if (event.pointerType !== "mouse") return;
                          const rect = event.currentTarget.getBoundingClientRect();
                          const below = rect.top < 140;
                          setHover({ detail, x: rect.left + rect.width / 2, y: below ? rect.bottom : rect.top, below });
                        }}
                        onPointerLeave={() => setHover(null)}
                        tabIndex={0}
                        role="button"
                        aria-label={`${heatDay.label} ${hhmm(cell.start)}–${hhmm(cell.end)}: ${cell.count}/${total}${here.length > 0 ? ` · ${labels.legendMeeting}: ${here.map((meeting) => meeting.title).join(", ")}` : ""}`}
                        onClick={() => {
                          setHover(null);
                          setActiveCell(detail);
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== " " && event.key !== "Enter") return;
                          event.preventDefault();
                          setActiveCell(detail);
                        }}
                      >
                        {titled.length > 0 && <span className="cell-meeting">{titled[0].title}</span>}
                      </td>
                    );
                  })}
                </tr>,
              ])}
            </tbody>
          </table>
        </div>

        <div className="legend">
          <span>{labels.legendAll}</span>
          {["h0", "h1", "h2", "h3", "h4", "h5"].map((cls) => (
            <i key={cls} className={cls} />
          ))}
          <span>{labels.legendNone}</span>
          <i className="swatch-meeting" />
          <span>{labels.legendMeeting}</span>
          <i className="swatch-mine" />
          <span>{labels.legendMine}</span>
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
          {payload.people.length > 1 && (
            <div className="field">
              <div className="who-head">
                <span className="label" id="who-label">
                  {labels.whoNeeded
                    .replace("{n}", String(chosenCount))
                    .replace("{total}", String(filledIds.length))}
                </span>
                {selected !== null && (
                  <button type="button" className="btn btn-sm btn-quiet" onClick={() => setSelected(null)}>
                    {labels.whoAll}
                  </button>
                )}
              </div>
              <ul className="who-list" aria-labelledby="who-label">
                {payload.people.map((person) => (
                  <li key={person.id}>
                    <label className={`who-row${person.filled ? "" : " off"}`}>
                      <input
                        type="checkbox"
                        checked={isOn(person.id)}
                        disabled={!person.filled}
                        onChange={() => togglePerson(person.id)}
                      />
                      <span className="who-name">{person.name}</span>
                      {!person.filled && <span className="small muted">{labels.notFilled}</span>}
                    </label>
                  </li>
                ))}
              </ul>
              <p className="small muted" style={{ margin: "6px 0 0" }}>
                {labels.whoHint}
              </p>
            </div>
          )}
        </div>

        {day && (
          <p className="small muted" style={{ margin: "2px 0 6px" }}>
            {day.label} ·{" "}
            {labels.variantsTemplate.replace("{n}", String(day.items.length))} ·{" "}
            {durationText(payload.duration, labels)}
          </p>
        )}

        <div className="slotlist">
          {payload.selectedTotal === 0 ? (
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
                      {item.count}/{payload.selectedTotal}
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
      </div>

      {hover && !activeCell && (
        <div
          className={`cell-tooltip${hover.below ? " below" : ""}`}
          role="tooltip"
          style={{ left: hover.x, top: hover.y }}
        >
          <div className="cell-tooltip-head">
            {hover.detail.dayLabel} · {hhmm(hover.detail.start)}–{hhmm(hover.detail.end)}
          </div>
          {hover.detail.meetings.map((title, index) => (
            <div key={index} className="cell-popover-meeting">
              <IconMeeting /> {title}
            </div>
          ))}
          <WhoIsFree detail={hover.detail} total={total} labels={labels} />
        </div>
      )}

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
            {activeCell.meetings.map((title, index) => (
              <p key={index} className="cell-popover-meeting">
                <IconMeeting /> {title}
              </p>
            ))}
            <WhoIsFree detail={activeCell} total={total} labels={labels} />
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
    </>
  );
}

/** Кто свободен и кто занят в клетке — общее для подсказки и окна по нажатию. */
function WhoIsFree({ detail, total, labels }: { detail: CellDetail; total: number; labels: BoardLabels }) {
  return (
    <div className="who-free small">
      <div>
        <span className="who-free-label ok">
          {labels.freeNames} {detail.count}/{total}:
        </span>{" "}
        {detail.free.length > 0 ? detail.free.join(", ") : labels.nobody}
      </div>
      {detail.missing.length > 0 && (
        <div>
          <span className="who-free-label">{labels.busyNames}:</span> {detail.missing.join(", ")}
        </div>
      )}
    </div>
  );
}

/** Насколько далеко вперёд можно листать недели (на сервере значение то же). */
const MAX_WEEK = 8;

/** Сравнимый вид выбора участников: порядок щелчков значения не имеет. */
function selectionKey(selected: number[] | null): string {
  return selected === null ? "all" : [...selected].sort((a, b) => a - b).join(",");
}
