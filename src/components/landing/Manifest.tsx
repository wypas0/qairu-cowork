"use client";

import { useRef } from "react";

import { type ScrollRange, useScrollProgress } from "./useScrollProgress";

/**
 * Строки наливаются, пока манифест идёт от низа окна к середине: 0 — верх
 * блока на 85 % высоты окна, 1 — середина блока на середине окна.
 */
const MANIFEST_RANGE: ScrollRange = {
  from: (_box, viewport) => viewport * 0.85,
  to: (box, viewport) => viewport * 0.5 - box.offsetHeight / 2,
};

/**
 * Л3. Манифест: каждая строка — тусклый слой и яркий поверх, обрезанный
 * справа (`clip-path`). Прокрутка наливает строки по очереди: строка n — на
 * своей трети прогресса (landing.css). Украшение: смысл уже сказан
 * заголовком витрины, поэтому для скринридера блок скрыт.
 */
export function Manifest({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useScrollProgress(ref, MANIFEST_RANGE);
  return (
    <p ref={ref} className="manifest display-caps" aria-hidden="true">
      {lines.map((line, index) => (
        <span className="manifest-line" key={line} style={{ "--n": index } as React.CSSProperties}>
          <span className="manifest-dim">{line}</span>
          <span className="manifest-lit">{line}</span>
        </span>
      ))}
    </p>
  );
}
