"use client";

import { useEffect, useRef, useState } from "react";

import { slideIn, useThumb } from "../motion";

export type BestOption = { label: string; rows: { when: string; free: string }[] };

/**
 * Плитка «Лучшее время»: длина встречи — сегменты с подложкой (useThumb),
 * список из трёх окон приходит с той стороны, куда переключили. Данные
 * выдуманные и готовые — их собирает сервер (Bento).
 */
export function TileBest({ options, label }: { options: BestOption[]; label: string }) {
  const [index, setIndex] = useState(0);
  const segRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const direction = useRef<1 | -1 | null>(null);
  useThumb(segRef, index);

  useEffect(() => {
    if (direction.current !== null) slideIn(listRef.current, direction.current);
  }, [index]);

  return (
    <>
      <div className="seg" role="radiogroup" aria-label={label} ref={segRef}>
        {options.map((option, at) => (
          <button
            key={option.label}
            type="button"
            role="radio"
            aria-checked={at === index}
            className={at === index ? "active" : undefined}
            onClick={() => {
              if (at === index) return;
              direction.current = at > index ? 1 : -1;
              setIndex(at);
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
      <ul className="tile-list" ref={listRef} key={index}>
        {options[index].rows.map((row) => (
          <li key={row.when}>
            <b className="tnum">{row.when}</b>
            <span className="small muted">{row.free}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
