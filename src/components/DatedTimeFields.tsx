"use client";

import { useState } from "react";

/**
 * «Весь день» и поля времени разовой занятости.
 *
 * Пока отмечен «весь день», время заблокировано и не уходит в форму — иначе
 * человек вписал бы часы, забыл снять галочку и получил бы занятые сутки.
 */
export function DatedTimeFields({
  labels,
}: {
  labels: { allDay: string; start: string; end: string; hint: string };
}) {
  const [allDay, setAllDay] = useState(true);

  return (
    <>
      <label className="checkbox">
        <input
          type="checkbox"
          name="all_day"
          checked={allDay}
          onChange={(event) => setAllDay(event.target.checked)}
        />
        <span>{labels.allDay}</span>
      </label>
      <div className="row">
        <div className="field">
          <label htmlFor="start">{labels.start}</label>
          <input id="start" name="start" type="time" step={300} disabled={allDay} required={!allDay} />
        </div>
        <div className="field">
          <label htmlFor="end">{labels.end}</label>
          <input id="end" name="end" type="time" step={300} disabled={allDay} required={!allDay} />
        </div>
      </div>
      <p className="small muted" style={{ marginTop: -6 }}>
        {labels.hint}
      </p>
    </>
  );
}
