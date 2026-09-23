"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";

import { type WallNow, wallNow } from "./time";

/**
 * «Сейчас» в поясе группы, раз в минуту заново. На сервере не считается:
 * разметка сервера и браузера должна совпасть, поэтому до гидратации — null,
 * и отметки «сегодня» и «прошло» появляются сразу после загрузки.
 */
export function useWallNow(tz: string): WallNow | null {
  const [now, setNow] = useState<WallNow | null>(null);
  useEffect(() => {
    const tick = () => setNow(wallNow(tz));
    tick();
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, [tz]);
  return now;
}

/** Протяжка мышью: день и ряды, с которого начали и до которого дотянули. */
export type Drag = { date: string; from: number; to: number };

/** Клетка, как её видел человек в момент протяжки: время не ищется потом заново. */
export type DragCell = { row: number; start: number; end: number };

/** Итог протяжки: день, начало первой клетки и конец последней. */
export type DragResult = { date: string; start: number; end: number };

/**
 * Протяжка мышью по клеткам одного дня — выбор времени встречи целиком.
 *
 * Пальцем по карте листают страницу, поэтому протяжка только для мыши.
 * Закончить её можно где угодно, даже за пределами карты. Щелчок, который
 * браузер присылает следом за отпусканием, окно клетки открыть не должен —
 * для этого `shouldSkipClick`.
 *
 * Время клеток запоминается в момент протяжки: если посередине подъехали
 * данные другой недели, выбор всё равно тот, что человек видел.
 */
export function useDragSelect(onSelect: (result: DragResult) => void) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const current = useRef<{ date: string; from: DragCell; to: DragCell; moved: boolean } | null>(null);
  const skipClick = useRef(false);
  const select = useEffectEvent(onSelect);

  useEffect(() => {
    function finish() {
      const done = current.current;
      if (!done) return;
      current.current = null;
      setDrag(null);
      if (!done.moved) return;
      skipClick.current = true;
      setTimeout(() => {
        skipClick.current = false;
      }, 0);
      const [first, last] = done.from.row <= done.to.row ? [done.from, done.to] : [done.to, done.from];
      select({ date: done.date, start: first.start, end: last.end });
    }
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, []);

  return {
    drag,
    dragging: () => current.current !== null,
    start(date: string, cell: DragCell) {
      current.current = { date, from: cell, to: cell, moved: false };
    },
    /** Мышь зашла в клетку во время протяжки: растягиваем выбор, если день тот же. */
    extend(date: string, cell: DragCell) {
      const active = current.current;
      if (!active || active.date !== date || active.to.row === cell.row) return;
      active.to = cell;
      active.moved = true;
      setDrag({ date: active.date, from: active.from.row, to: cell.row });
    },
    shouldSkipClick: () => skipClick.current,
  };
}
