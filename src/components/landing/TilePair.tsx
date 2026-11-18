"use client";

import { useState } from "react";

/** Полоска дня 8:00–22:00, как в PairPlanner. */
const FROM = 8 * 60;
const TO = 22 * 60;
/** Когда оба свободны, минуты от полуночи. */
const FREE: [number, number][] = [
  [10 * 60, 11 * 60],
  [14 * 60, 16 * 60],
  [18 * 60, 20 * 60],
];
const TICKS = [8, 12, 16, 20];

const at = (minutes: number) => `${(((minutes - FROM) / (TO - FROM)) * 100).toFixed(2)}%`;
const span = (from: number, to: number) => `${(((to - from) / (TO - FROM)) * 100).toFixed(2)}%`;
const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/**
 * Плитка «Встреча вдвоём»: два человека и полоска дня — синим, когда оба
 * свободны. Нажатие на свободный отрезок ставит встречу на его первый час
 * (на 14:00–16:00 — «14:00–15:00»).
 */
export function TilePair({
  people,
  day,
  hint,
  free,
}: {
  /** Инициалы и имена двоих. */
  people: [string, string][];
  /** «Чт» на языке страницы. */
  day: string;
  hint: string;
  /** «Вы оба свободны: {time}» — подпись отрезка для скринридера. */
  free: string;
}) {
  const [chosen, setChosen] = useState<number | null>(null);
  return (
    <>
      <div className="pair-people" aria-hidden="true">
        {people.map(([mark, name]) => (
          <span className="pair-person" key={name}>
            <span className="who-avatar-mark">{mark}</span>
            <span className="small">{name}</span>
          </span>
        ))}
        <span className="pair-day small muted">{day}</span>
      </div>
      <div className="pair-axis" aria-hidden="true">
        {TICKS.map((hour) => (
          <span key={hour} style={{ left: at(hour * 60) }}>
            {hour}
          </span>
        ))}
      </div>
      <div className="pair-strip">
        {FREE.map(([start, end]) => (
          <button
            key={start}
            type="button"
            className="pair-free"
            style={{ left: at(start), width: span(start, end) }}
            aria-pressed={chosen === start}
            aria-label={free.replace("{time}", `${day} ${hhmm(start)}–${hhmm(end)}`)}
            onClick={() => setChosen(start)}
          />
        ))}
        {chosen !== null && (
          <i
            className="pair-chosen"
            key={chosen}
            data-enter="pop"
            style={{ left: at(chosen), width: span(chosen, chosen + 60) }}
          />
        )}
      </div>
      <p className={`small pair-result${chosen === null ? " muted" : ""}`} aria-live="polite">
        {chosen === null ? hint : `${day} · ${hhmm(chosen)}–${hhmm(chosen + 60)}`}
      </p>
    </>
  );
}
