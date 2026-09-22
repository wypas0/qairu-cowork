"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { BEST_COOKIE, setViewCookie } from "@/lib/cookies";
import type { BoardPayload } from "@/lib/group";
import { CopyButton } from "./CopyButton";
import { IconChevronLeft, IconChevronRight, IconClose, IconMeeting } from "./icons";
import { BreakRow, PeriodTime, hhmm } from "./PeriodRow";

export type PickDetail = { value: string; text: string };

/** Событие «назначить встречу на это время» — им доска говорит форме встречи. */
export const PICK_EVENT = "qairu:pick";

export type BoardLabels = {
  bestTitle: string;
  bestLead: string;
  bestEmpty: string;
  bestAll: string;
  moreDays: string; // «и ещё {n}»
  bestCount: string; // «свободны {n} из {total}»
  bestHide: string;
  bestShow: string;
  rowsTrimmed: string; // «Скрыты часы, когда никто не свободен»
  rowsShowAll: string;
  rowsHideEmpty: string;
  copyWindows: string;
  copiedWindows: string;
  copyHead: string; // «Общие окна · {duration}» — литеральный {duration}
  copyWithout: string; // «без {names}» — литеральный {names}
  nowLabel: string;
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

/** h0 — свободны все (ярко-голубая клетка), h5 — никого (тёмно-синяя): светлее — полезнее окно. */
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
  initialBestHidden = false,
}: {
  slug: string;
  initial: BoardPayload;
  durationOptions: number[];
  labels: BoardLabels;
  /** «Лучшее время» свёрнуто — запоминается кукой на устройстве. */
  initialBestHidden?: boolean;
}) {
  const [payload, setPayload] = useState(initial);
  const [bestHidden, setBestHidden] = useState(initialBestHidden);

  function toggleBest(hide: boolean) {
    setBestHidden(hide);
    setViewCookie(BEST_COOKIE, hide ? "hidden" : null);
  }
  // Кто должен прийти. null — все, у кого есть расписание.
  const [selected, setSelected] = useState<number[] | null>(initial.selected);
  const [duration, setDuration] = useState(initial.duration);
  const [week, setWeek] = useState(initial.week);
  const [selectedDay, setSelectedDay] = useState(() => firstDayWithSlots(initial));
  const [loading, setLoading] = useState(false);
  const [activeCell, setActiveCell] = useState<CellDetail | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  // Кого подсветить на карте: наведение на имя в «Кто должен прийти» (как в When2meet).
  const [spot, setSpot] = useState<number | null>(null);
  // Протяжка мышью по клеткам одного дня — так выбирают время встречи целиком.
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<(Drag & { moved: boolean }) | null>(null);
  const skipClick = useRef(false);
  // «Сейчас» в поясе группы. На сервере его не считаем: разметка сервера и
  // браузера должна совпасть, поэтому отметки появляются после загрузки.
  const [now, setNow] = useState<WallNow | null>(null);
  // Пустые часы по краям дня (никто не свободен) скрыты, пока не попросят показать.
  const [allRows, setAllRows] = useState(false);
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

  // Часы группы идут сами: раз в минуту двигаем линию «сейчас» и гасим прошедшее.
  useEffect(() => {
    const tick = () => setNow(wallNow(payload.tz));
    tick();
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, [payload.tz]);

  // Протяжку заканчивает отпускание кнопки где угодно, даже за пределами карты.
  useEffect(() => {
    function finish() {
      const current = dragRef.current;
      if (!current) return;
      dragRef.current = null;
      setDrag(null);
      if (!current.moved) return;
      // Следом за отпусканием браузер пришлёт щелчок — окно клетки он открыть не должен.
      skipClick.current = true;
      setTimeout(() => {
        skipClick.current = false;
      }, 0);
      const heatDay = payload.days.find((entry) => entry.date === current.date);
      if (!heatDay) return;
      const start = heatDay.cells[Math.min(current.from, current.to)].start;
      const end = heatDay.cells[Math.max(current.from, current.to)].end;
      pick(heatDay.date, start, end, `${heatDay.label} · ${hhmm(start)}–${hhmm(end)}`);
    }
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [payload.days]);

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

  // Сегодняшние окна начинаются не раньше, чем сейчас: встречу в прошедшее
  // утро не назначить. Окно, от которого осталось меньше длины встречи, уходит.
  const from = now ? Math.ceil(now.min / 10) * 10 : null;
  const upcoming = <T extends { start: number; end: number; text: string }>(date: string, item: T): T | null => {
    if (from === null || !now || date !== now.day || item.start >= from) return item;
    if (item.end - from < payload.duration) return null;
    return { ...item, start: from, text: `${hhmm(from)}–${hhmm(item.end)}` };
  };
  const slotDays = payload.slotDays.map((entry) => ({
    ...entry,
    items: entry.items
      .map((item) => upcoming(entry.date, item))
      .filter((item): item is (typeof entry.items)[number] => item !== null),
  }));
  // В «Лучшем времени» у сегодняшнего дня то же правило; строка без дней пропадает.
  const best = payload.best
    .map((item) => ({
      ...item,
      dates: item.dates.filter((entry) => upcoming(entry.date, item) === item),
    }))
    .filter((item) => item.dates.length > 0);

  const day = slotDays.find((entry) => entry.date === selectedDay) ?? slotDays[0];

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

  // Окна текстом — вставить в чат группы одним сообщением.
  const windowsText = [
    labels.copyHead.replace("{duration}", durationText(payload.duration, labels)),
    ...slotDays
      .filter((entry) => entry.items.length > 0)
      .map(
        (entry) =>
          `${entry.short}: ${entry.items
            .map((item) =>
              item.missing.length > 0
                ? `${item.text} (${labels.copyWithout.replace("{names}", item.missing.join(", "))})`
                : item.text,
            )
            .join(", ")}`,
      ),
  ].join("\n");
  const hasWindows = slotDays.some((entry) => entry.items.length > 0);

  const today = now?.day ?? payload.today;

  return (
    <>
      {/* ============ главный ответ страницы ============
          Закрывается крестиком: кто назначает по карте, тому список не нужен.
          Свёрнутый остаётся одной строкой — вернуть его можно в одно нажатие. */}
      {bestHidden ? (
        <section className="card best-collapsed">
          <div className="card-head">
            <h2>{labels.bestTitle}</h2>
            <button type="button" className="btn btn-sm" onClick={() => toggleBest(false)}>
              {labels.bestShow}
            </button>
          </div>
        </section>
      ) : (
      <section className="card" aria-busy={loading}>
        <div className="card-head best-head">
          <h2>{labels.bestTitle}</h2>
          <button
            type="button"
            className="icon-btn best-close"
            aria-label={labels.bestHide}
            title={labels.bestHide}
            onClick={() => toggleBest(true)}
          >
            <IconClose size={18} />
          </button>
        </div>
        <p className="small muted">{labels.bestLead}</p>
        {best.length === 0 ? (
          <div className="empty">
            <h3>{labels.bestEmpty}</h3>
          </div>
        ) : (
          <ul className="best-list">
            {best.map((item) => {
              const first = item.dates[0];
              return (
                <li className="best-item" key={`${first.date}-${item.start}`}>
                  <span className="type-title-3 best-time">{item.text}</span>
                  <div className="best-text">
                    <b className="best-days">{daysText(item.dates, labels)}</b>
                    <span className="small muted">{whoText(item, payload.selectedTotal, labels)}</span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => pick(first.date, item.start, item.end, `${first.label} · ${item.text}`)}
                  >
                    {labels.pick}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      )}

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
          <table className={`week periods${drag ? " dragging" : ""}${spot !== null ? " spotting" : ""}`}>
            <thead>
              <tr>
                <th className="timecol" />
                {payload.days.map((heatDay) => (
                  <th
                    key={heatDay.date}
                    className={heatDay.date === today ? "today" : undefined}
                    aria-current={heatDay.date === today ? "date" : undefined}
                  >
                    {heatDay.short}
                    <br />
                    <span className="small muted">{heatDay.dm}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {payload.periods.map((period, row) =>
                row < firstShown || row > lastShown
                  ? null
                  : [
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
                        {payload.days.map((heatDay) => {
                          const cell = heatDay.cells[row];
                          const here = meetingsAt(heatDay.date, cell.start, cell.end);
                          // Подпись — только в первой клетке встречи за день, дальше просто красные.
                          const titled = here.filter(
                            (meeting) =>
                              row === firstShown ||
                              !(meeting.start < heatDay.cells[row - 1].end && heatDay.cells[row - 1].start < meeting.end),
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
                          const past =
                            now !== null &&
                            (heatDay.date < now.day || (heatDay.date === now.day && cell.end <= now.min));
                          const current =
                            now !== null && heatDay.date === now.day && cell.start <= now.min && now.min < cell.end;
                          const inRange =
                            drag !== null &&
                            drag.date === heatDay.date &&
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
                              key={`${heatDay.date}-${cell.start}`}
                              className={classes.filter(Boolean).join(" ")}
                              onPointerDown={(event) => {
                                // Протяжка — только мышью: пальцем по карте листают страницу.
                                if (event.pointerType !== "mouse" || event.button !== 0) return;
                                dragRef.current = { date: heatDay.date, from: row, to: row, moved: false };
                              }}
                              onPointerEnter={(event) => {
                                // Подсказка — для мыши; на телефоне то же самое показывает окно по нажатию.
                                if (event.pointerType !== "mouse") return;
                                const dragging = dragRef.current;
                                if (dragging) {
                                  setHover(null);
                                  if (dragging.date === heatDay.date && dragging.to !== row) {
                                    dragging.to = row;
                                    dragging.moved = true;
                                    setDrag({ date: dragging.date, from: dragging.from, to: row });
                                  }
                                  return;
                                }
                                const rect = event.currentTarget.getBoundingClientRect();
                                const below = rect.top < 140;
                                setHover({ detail, x: rect.left + rect.width / 2, y: below ? rect.bottom : rect.top, below });
                              }}
                              onPointerLeave={() => setHover(null)}
                              tabIndex={0}
                              role="button"
                              aria-label={`${heatDay.label} ${hhmm(cell.start)}–${hhmm(cell.end)}: ${cell.count}/${total}${here.length > 0 ? ` · ${labels.legendMeeting}: ${here.map((meeting) => meeting.title).join(", ")}` : ""}`}
                              onClick={() => {
                                if (skipClick.current) return;
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
                    ],
              )}
            </tbody>
          </table>
        </div>

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
        <div className="card-head">
          <h2>{labels.windowsTitle}</h2>
          {hasWindows && (
            <CopyButton value={windowsText} label={labels.copyWindows} copiedLabel={labels.copiedWindows} small />
          )}
        </div>

        <div className="field">
          <span className="label" id="slot-day-label">
            {labels.day}
          </span>
          <div className="daypicker" role="radiogroup" aria-labelledby="slot-day-label">
            {slotDays.map((entry) => {
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
                  <li
                    key={person.id}
                    // Наведение на имя подсвечивает на карте, когда этот человек свободен.
                    onMouseEnter={person.filled ? () => setSpot(person.id) : undefined}
                    onMouseLeave={person.filled ? () => setSpot(null) : undefined}
                    onFocus={person.filled ? () => setSpot(person.id) : undefined}
                    onBlur={person.filled ? () => setSpot(null) : undefined}
                  >
                    <label className={`who-row${person.filled ? "" : " off"}${spot === person.id ? " spotted" : ""}`}>
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
                    <span className="small muted">{whoText(item, payload.selectedTotal, labels)}</span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      // Окно может быть длиннее встречи — ставим её в начало окна.
                      const end = item.start + payload.duration;
                      pick(day.date, item.start, end, `${day.label} · ${hhmm(item.start)}–${hhmm(end)}`);
                    }}
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

/**
 * Кто свободен и кто занят в клетке — таблица в две колонки, общая для
 * подсказки при наведении и окна по нажатию. Свободные — на ярко-голубых
 * плашках, занятые — на тёмно-синих: колонку видно, не читая заголовок.
 */
function WhoIsFree({ detail, total, labels }: { detail: CellDetail; total: number; labels: BoardLabels }) {
  const rows = Math.max(detail.free.length, detail.missing.length, 1);
  return (
    <table className="who-table">
      <thead>
        <tr>
          <th scope="col" className="who-col-free">
            {labels.freeNames} <span className="who-count">{detail.count}/{total}</span>
          </th>
          <th scope="col" className="who-col-busy">
            {labels.busyNames} <span className="who-count">{detail.missing.length}/{total}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rows }, (_, index) => (
          <tr key={index}>
            <td>
              {detail.free[index] ? (
                <span className="who-pill free">{detail.free[index]}</span>
              ) : index === 0 ? (
                <span className="who-none">{labels.nobody}</span>
              ) : null}
            </td>
            <td>
              {detail.missing[index] ? (
                <span className="who-pill busy">{detail.missing[index]}</span>
              ) : index === 0 ? (
                <span className="who-none">—</span>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Насколько далеко вперёд можно листать недели (на сервере значение то же). */
const MAX_WEEK = 8;

/** Протяжка мышью: день и ряды, с которого начали и до которого дотянули. */
type Drag = { date: string; from: number; to: number };

/** Стенные часы группы: дата «ГГГГ-ММ-ДД» и минуты от полуночи. */
type WallNow = { day: string; min: number };

/** Который сейчас час у группы — в её поясе, а не в поясе браузера. */
function wallNow(tz: string): WallNow {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date())
      .map((part) => [part.type, part.value]),
  );
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    min: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** Сравнимый вид выбора участников: порядок щелчков значения не имеет. */
function selectionKey(selected: number[] | null): string {
  return selected === null ? "all" : [...selected].sort((a, b) => a - b).join(",");
}

/** «Пн 21.09, Вт 22.09, Ср 23.09» — не больше трёх дней, дальше «и ещё N». */
function daysText(dates: { short: string }[], labels: BoardLabels): string {
  const shown = dates.slice(0, 3).map((date) => date.short).join(", ");
  const rest = dates.length - 3;
  return rest > 0 ? `${shown} ${labels.moreDays.replace("{n}", String(rest))}` : shown;
}

/** «свободны все» или «свободны 7 из 9 — нет Асель, Болат». */
function whoText(
  item: { count: number; missing: string[] },
  total: number,
  labels: BoardLabels,
): string {
  if (item.missing.length === 0) return labels.bestAll;
  const count = labels.bestCount.replace("{n}", String(item.count)).replace("{total}", String(total));
  return `${count} — ${labels.missingShort} ${item.missing.join(", ")}`;
}
