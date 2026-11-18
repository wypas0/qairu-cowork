"use client";

import { useEffect, useRef, useState } from "react";

import { slideIn } from "../motion";

type Answer = "yes" | "maybe" | "no";

/**
 * Плитка «Бот зовёт сам»: приглашение в духе Telegram с теми же кнопками,
 * что шлёт бот. «Приду» прибавляет одного к счётчику — новая цифра приходит
 * снизу.
 */
export function TileBot({
  goal,
  when,
  answers,
  going,
}: {
  goal: string;
  when: string;
  /** Подписи кнопок: «Приду», «Может быть», «Не смогу». */
  answers: Record<Answer, string>;
  /** Счётчик до и после «Приду». */
  going: [string, string];
}) {
  const [answer, setAnswer] = useState<Answer | null>(null);
  const countRef = useRef<HTMLSpanElement>(null);
  const touched = useRef(false);
  const coming = answer === "yes";

  useEffect(() => {
    if (touched.current) slideIn(countRef.current, 0);
  }, [coming]);

  return (
    <div className="tg-msg">
      <p className="tg-msg-text">
        <b>{goal}</b>
        <span className="small muted tnum">{when}</span>
      </p>
      <p className="small tg-msg-count" aria-live="polite">
        <span ref={countRef} key={String(coming)} className="tg-count">
          {going[coming ? 1 : 0]}
        </span>
      </p>
      <div className="tg-msg-btns">
        {(["yes", "maybe", "no"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={answer === value}
            className={answer === value ? "active" : undefined}
            onClick={() => {
              touched.current = true;
              setAnswer(value);
            }}
          >
            {answers[value]}
          </button>
        ))}
      </div>
    </div>
  );
}
