"use client";

import { fmtMinutes } from "@/core/intervals";
import type { BoardPayload } from "@/lib/group";
import { CopyButton } from "../CopyButton";
import { type BoardLabels, durationText, whoText } from "./labels";

type SlotDay = BoardPayload["slotDays"][number];

/**
 * «Общие окна»: выбор дня, длины встречи и того, кто должен прийти, и
 * варианты с кнопкой «Назначить». Наведение на имя в списке людей
 * подсвечивает на карте, когда этот человек свободен (как в When2meet).
 */
export function WindowsCard({
  slotDays,
  day,
  onDay,
  duration,
  chosenDuration,
  durationOptions,
  onDuration,
  people,
  selected,
  onSelected,
  spot,
  onSpot,
  selectedTotal,
  loading,
  labels,
  onPick,
}: {
  slotDays: SlotDay[];
  day: SlotDay | undefined;
  onDay: (date: string) => void;
  /** Длина, для которой посчитаны варианты на экране. */
  duration: number;
  /** Длина в списке: пока идёт запрос, она уже новая, а варианты ещё прежние. */
  chosenDuration: number;
  durationOptions: number[];
  onDuration: (minutes: number) => void;
  people: BoardPayload["people"];
  selected: number[] | null;
  onSelected: (next: number[] | null) => void;
  spot: number | null;
  onSpot: (id: number | null) => void;
  selectedTotal: number;
  loading: boolean;
  labels: BoardLabels;
  onPick: (date: string, start: number, end: number, text: string) => void;
}) {
  // Считать окна можно не для всех, а для тех, без кого встреча не имеет
  // смысла. Не заполнившие расписание в расчёт не попадают — про них
  // неизвестно, свободны ли они.
  const filledIds = people.filter((person) => person.filled).map((person) => person.id);
  const isOn = (id: number) => (selected === null ? filledIds.includes(id) : selected.includes(id));
  const chosenCount = selected === null ? filledIds.length : selected.length;

  function togglePerson(id: number) {
    const current = selected ?? filledIds;
    const next = current.includes(id) ? current.filter((other) => other !== id) : [...current, id];
    // Хотя бы один человек должен остаться — иначе считать нечего.
    if (next.length === 0) return;
    onSelected(next.length === filledIds.length ? null : next);
  }

  // Окна текстом — вставить в чат группы одним сообщением.
  const windowsText = [
    labels.copyHead.replace("{duration}", durationText(duration, labels)),
    ...slotDays
      .filter((entry) => entry.items.length > 0)
      .map(
        (entry) =>
          `${entry.short}: ${entry.items
            .map((item) =>
              item.missing.length > 0
                ? `${item.text} (${labels.copyWithout.replace("{names}", item.missing.join(", "))})`
                : item.text,
            )
            .join(", ")}`,
      ),
  ].join("\n");
  const hasWindows = slotDays.some((entry) => entry.items.length > 0);

  return (
    <section className="card windows-card" aria-busy={loading}>
      <div className="card-head">
        <h2>{labels.windowsTitle}</h2>
        {hasWindows && (
          <CopyButton value={windowsText} label={labels.copyWindows} copiedLabel={labels.copiedWindows} small />
        )}
      </div>

      <div className="field">
        <span className="label" id="slot-day-label">
          {labels.day}
        </span>
        <div className="daypicker" role="radiogroup" aria-labelledby="slot-day-label">
          {slotDays.map((entry) => {
            const active = entry.date === day?.date;
            return (
              <button
                key={entry.date}
                type="button"
                role="radio"
                aria-checked={active}
                className={`daychip${active ? " active" : ""}${entry.items.length === 0 ? " empty" : ""}`}
                onClick={() => onDay(entry.date)}
                title={entry.label}
              >
                <span>{entry.short}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="row">
        <div className="field">
          <label htmlFor="duration">{labels.duration}</label>
          <select id="duration" value={chosenDuration} onChange={(event) => onDuration(Number(event.target.value))}>
            {durationOptions.map((value) => (
              <option key={value} value={value}>
                {durationText(value, labels)}
              </option>
            ))}
          </select>
        </div>
        {people.length > 1 && (
          <div className="field">
            <div className="who-head">
              <span className="label" id="who-label">
                {labels.whoNeeded.replace("{n}", String(chosenCount)).replace("{total}", String(filledIds.length))}
              </span>
              {selected !== null && (
                <button type="button" className="btn btn-sm btn-quiet" onClick={() => onSelected(null)}>
                  {labels.whoAll}
                </button>
              )}
            </div>
            <ul className="who-list" aria-labelledby="who-label">
              {people.map((person) => (
                <li
                  key={person.id}
                  onMouseEnter={person.filled ? () => onSpot(person.id) : undefined}
                  onMouseLeave={person.filled ? () => onSpot(null) : undefined}
                  onFocus={person.filled ? () => onSpot(person.id) : undefined}
                  onBlur={person.filled ? () => onSpot(null) : undefined}
                >
                  <label className={`who-row${person.filled ? "" : " off"}${spot === person.id ? " spotted" : ""}`}>
                    <input
                      type="checkbox"
                      checked={isOn(person.id)}
                      disabled={!person.filled}
                      onChange={() => togglePerson(person.id)}
                    />
                    <span className="who-name">{person.name}</span>
                    {!person.filled && <span className="small muted">{labels.notFilled}</span>}
                  </label>
                </li>
              ))}
            </ul>
            <p className="small muted who-hint">{labels.whoHint}</p>
          </div>
        )}
      </div>

      {day && (
        <p className="small muted windows-meta">
          {day.label} · {labels.variantsTemplate.replace("{n}", String(day.items.length))} ·{" "}
          {durationText(duration, labels)}
        </p>
      )}

      <div className="slotlist">
        {selectedTotal === 0 ? (
          <p className="muted small">{labels.windowsNoData}</p>
        ) : !day || day.items.length === 0 ? (
          <p className="muted small">{labels.windowsEmpty}</p>
        ) : (
          <ul className="windows">
            {day.items.map((item) => (
              <li key={`${day.date}-${item.start}`} className="slotrow">
                <div className="slotinfo">
                  <span className="when">{item.text}</span>{" "}
                  <span className="small muted">{whoText(item, selectedTotal, labels)}</span>
                </div>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    // Окно может быть длиннее встречи — ставим её в начало окна.
                    const end = item.start + duration;
                    onPick(day.date, item.start, end, `${day.label} · ${fmtMinutes(item.start)}–${fmtMinutes(end)}`);
                  }}
                >
                  {labels.pick}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
