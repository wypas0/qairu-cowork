"use client";

import { useEffect, useRef, useState } from "react";

import { DEMO_PEOPLE } from "@/core/landingDemo";
import { IconCheck } from "../icons";
import { calm } from "../motion";

/** Чьи пары «переносятся»: неделя Амира из демо. */
const WEEK = DEMO_PEOPLE[0].busy;
const BUSY_COUNT = WEEK.flat().filter(Boolean).length;
/** Порядок закрашивания: n-я занятая клетка по строкам. */
const ORDER: number[] = [];
WEEK.flat().reduce((seen, busy) => {
  ORDER.push(seen);
  return busy ? seen + 1 : seen;
}, 0);
/** Задержка между клетками и длина проявления одной клетки, мс (--dur-base). */
const STEP_MS = 25;
const FADE_MS = 220;

/**
 * Плитка «Перенос из кампуса»: пустая сетка, по нажатию клетки пар
 * закрашиваются по очереди (по 25 мс на клетку, только opacity), потом
 * кнопка становится «Готово» с галочкой.
 */
export function TileCampus({ go, done }: { go: string; done: string }) {
  const [state, setState] = useState<"empty" | "filling" | "done">("empty");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  function run() {
    if (state !== "empty") return;
    setState("filling");
    timer.current = setTimeout(() => setState("done"), calm() ? 0 : (BUSY_COUNT - 1) * STEP_MS + FADE_MS);
  }

  return (
    <>
      <div className={`tile-grid${state === "empty" ? "" : " filled"}`} aria-hidden="true">
        {WEEK.flat().map((busy, index) => (
          <i
            key={index}
            className={busy ? "busy" : undefined}
            style={busy ? ({ "--k": ORDER[index] } as React.CSSProperties) : undefined}
          />
        ))}
      </div>
      {state === "done" ? (
        <button type="button" className="btn btn-sm" aria-disabled="true">
          <IconCheck size={16} />
          {done}
        </button>
      ) : (
        <button type="button" className="btn btn-sm btn-primary" onClick={run} aria-disabled={state === "filling" || undefined}>
          {go}
        </button>
      )}
    </>
  );
}
