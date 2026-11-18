"use client";

import { useState } from "react";

/** День встречи в мини-неделе: среда. */
const MEETING_DAY = 2;

/**
 * Плитка «Повторы и календарь»: три мини-недели, встреча в среду первой.
 * Тумблер «Повторять каждую неделю» добавляет её в две следующие недели —
 * клетки проявляются с лёгким перелётом, одна за другой.
 */
export function TileRepeat({ label, weeks, days }: { label: string; weeks: string[]; days: string[] }) {
  const [on, setOn] = useState(false);
  return (
    <>
      <label className="tile-switch">
        <input
          type="checkbox"
          role="switch"
          className="switch"
          checked={on}
          onChange={(event) => setOn(event.target.checked)}
        />
        <span>{label}</span>
      </label>
      <div className={`tile-weeks${on ? " on" : ""}`} aria-hidden="true">
        <span />
        {days.map((day) => (
          <span key={day} className="tile-weeks-day">
            {day}
          </span>
        ))}
        {weeks.map((week, index) => (
          <div className="tile-weeks-row" key={week} style={{ "--k": index } as React.CSSProperties}>
            <span className="tile-weeks-label">{week}</span>
            {days.map((day, at) => (
              <i key={day} className={at === MEETING_DAY ? (index === 0 ? "meet" : "meet later") : undefined} />
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
