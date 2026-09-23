"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { fmtMinutes } from "@/core/intervals";
import { BEST_COOKIE, setViewCookie } from "@/lib/cookies";
import type { BoardPayload } from "@/lib/group";
import { pickMeeting } from "../pick";
import { BestTime } from "./BestTime";
import { type CellDetail, CellPopover, CellTooltip, type Hover } from "./CellDetails";
import { HeatMap } from "./HeatMap";
import { useWallNow } from "./hooks";
import type { BoardLabels } from "./labels";
import { clipToNow, selectionKey } from "./time";
import { WindowsCard } from "./WindowsCard";

export type { BoardLabels } from "./labels";

/** День по умолчанию: первый, где есть хоть один вариант; иначе сегодня. */
function firstDayWithSlots(payload: BoardPayload): string {
  return (payload.slotDays.find((day) => day.items.length > 0) ?? payload.slotDays[0])?.date ?? "";
}

/**
 * Доска группы: «Лучшее время», карта недели и «Общие окна».
 *
 * Здесь только состояние и загрузка данных; каждая карточка — свой файл.
 * Выбор участников, длины встречи и недели пересчитывается на сервере
 * (`/api/g/[slug]/state`) с паузой после последнего щелчка.
 */
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
  // Кто должен прийти. null — все, у кого есть расписание.
  const [selected, setSelected] = useState<number[] | null>(initial.selected);
  const [duration, setDuration] = useState(initial.duration);
  const [week, setWeek] = useState(initial.week);
  const [selectedDay, setSelectedDay] = useState(() => firstDayWithSlots(initial));
  const [loading, setLoading] = useState(false);
  const [activeCell, setActiveCell] = useState<CellDetail | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  // Кого подсветить на карте: наведение на имя в «Кто должен прийти».
  const [spot, setSpot] = useState<number | null>(null);
  const now = useWallNow(payload.tz);
  const requestId = useRef(0);
  // Для каких выбора, длительности и недели посчитаны данные на экране.
  // Сравнивать нужно с ними, а не с начальными значениями: иначе
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
        const params = new URLSearchParams({ duration: String(nextDuration), week: String(nextWeek) });
        if (nextSelected) params.set("members", nextSelected.join(","));
        const response = await fetch(`/api/g/${slug}/state?${params}`, { credentials: "same-origin" });
        if (!response.ok) return;
        const data = (await response.json()) as BoardPayload;
        // Ответы могут прийти не в том порядке, в каком уехали запросы.
        if (id === requestId.current) {
          loaded.current = { selected: selectionKey(nextSelected), duration: nextDuration, week: nextWeek };
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

  function toggleBest(hide: boolean) {
    setBestHidden(hide);
    setViewCookie(BEST_COOKIE, hide ? "hidden" : null);
  }

  function pick(date: string, start: number, end: number, text: string) {
    pickMeeting({ value: `${date}T${fmtMinutes(start)}|${end - start}`, text });
  }

  // Сегодняшние окна начинаются не раньше, чем сейчас: встречу в прошедшее
  // утро не назначить. Окно, от которого осталось меньше длины встречи, уходит.
  const slotDays = payload.slotDays.map((entry) => ({
    ...entry,
    items: entry.items
      .map((item) => clipToNow(entry.date, item, now, payload.duration))
      .filter((item): item is (typeof entry.items)[number] => item !== null),
  }));
  // В «Лучшем времени» у сегодняшнего дня то же правило; строка без дней пропадает.
  const best = payload.best
    .map((item) => ({
      ...item,
      dates: item.dates.filter((entry) => clipToNow(entry.date, item, now, payload.duration) === item),
    }))
    .filter((item) => item.dates.length > 0);
  const day = slotDays.find((entry) => entry.date === selectedDay) ?? slotDays[0];

  return (
    <>
      <BestTime
        best={best}
        total={payload.selectedTotal}
        hidden={bestHidden}
        loading={loading}
        labels={labels}
        onToggle={toggleBest}
        onPick={pick}
      />

      <div className="grid-2 board-grid">
        <HeatMap
          payload={payload}
          week={week}
          onWeek={setWeek}
          now={now}
          spot={spot}
          loading={loading}
          labels={labels}
          onHover={setHover}
          onOpen={setActiveCell}
          onPick={pick}
        />
        <WindowsCard
          slotDays={slotDays}
          day={day}
          onDay={setSelectedDay}
          duration={payload.duration}
          chosenDuration={duration}
          durationOptions={durationOptions}
          onDuration={setDuration}
          people={payload.people}
          selected={selected}
          onSelected={setSelected}
          spot={spot}
          onSpot={setSpot}
          selectedTotal={payload.selectedTotal}
          loading={loading}
          labels={labels}
          onPick={pick}
        />
      </div>

      {hover && !activeCell && <CellTooltip hover={hover} total={payload.total} labels={labels} />}

      {activeCell && (
        <CellPopover
          detail={activeCell}
          total={payload.total}
          labels={labels}
          onClose={() => setActiveCell(null)}
          onPick={() => {
            pick(
              activeCell.date,
              activeCell.start,
              activeCell.end,
              `${activeCell.dayLabel} · ${fmtMinutes(activeCell.start)}–${fmtMinutes(activeCell.end)}`,
            );
            setActiveCell(null);
          }}
        />
      )}
    </>
  );
}
