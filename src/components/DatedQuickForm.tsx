"use client";

import { useState } from "react";

import { DatedTimeFields } from "./DatedTimeFields";

export type DatedQuickLabels = {
  day: string;
  today: string;
  tomorrow: string;
  other: string;
  add: string;
  more: string;
  less: string;
  to: string;
  toHint: string;
  label: string;
  labelPh: string;
  allDay: string;
  start: string;
  end: string;
  timeHint: string;
};

/**
 * Разовая занятость в два нажатия: «Завтра» → «Добавить».
 *
 * Чаще всего человек занят один день целиком — отработка, поездка, экзамен, —
 * поэтому по умолчанию так и есть. Время, несколько дней подряд и подпись
 * спрятаны под «Подробнее»: они нужны реже, а раньше стояли в форме всегда и
 * превращали простое действие в анкету.
 */
export function DatedQuickForm({
  action,
  today,
  tomorrow,
  labels,
}: {
  action: (formData: FormData) => void | Promise<void>;
  today: string;
  tomorrow: string;
  labels: DatedQuickLabels;
}) {
  const [day, setDay] = useState<"today" | "tomorrow" | "other">("tomorrow");
  const [other, setOther] = useState("");
  const [details, setDetails] = useState(false);
  const date = day === "today" ? today : day === "tomorrow" ? tomorrow : other;

  const choices = [
    ["today", labels.today],
    ["tomorrow", labels.tomorrow],
    ["other", labels.other],
  ] as const;

  return (
    <form action={action} className="dated-quick">
      <input type="hidden" name="date_from" value={date} />
      {/* Без подробностей — занят весь день: поля времени тогда не нужны. */}
      {!details && <input type="hidden" name="all_day" value="on" />}

      <div className="daypicker" role="radiogroup" aria-label={labels.day}>
        {choices.map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={day === value}
            className={`daychip${day === value ? " active" : ""}`}
            onClick={() => setDay(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {day === "other" && (
        <div className="field" style={{ marginTop: 12 }}>
          <input
            type="date"
            aria-label={labels.day}
            min={today}
            value={other}
            onChange={(event) => setOther(event.target.value)}
            required
          />
        </div>
      )}

      {details && (
        <div className="dated-details">
          <DatedTimeFields
            labels={{ allDay: labels.allDay, start: labels.start, end: labels.end, hint: labels.timeHint }}
          />
          <div className="row">
            <div className="field">
              <label htmlFor="date_to">{labels.to}</label>
              <input id="date_to" name="date_to" type="date" min={date || today} />
            </div>
            <div className="field">
              <label htmlFor="label">{labels.label}</label>
              <input id="label" name="label" type="text" maxLength={60} placeholder={labels.labelPh} />
            </div>
          </div>
          <p className="small muted" style={{ marginTop: -6 }}>
            {labels.toHint}
          </p>
        </div>
      )}

      <div className="dated-actions">
        <button className="btn" type="submit" disabled={!date}>
          {labels.add}
        </button>
        <button className="btn btn-sm btn-quiet" type="button" onClick={() => setDetails(!details)}>
          {details ? labels.less : labels.more}
        </button>
      </div>
    </form>
  );
}
