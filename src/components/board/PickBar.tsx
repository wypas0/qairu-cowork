"use client";

import type { BoardPayload } from "@/lib/group";
import { type BoardLabels, durationText } from "./labels";

/**
 * Полоса подбора над «Лучшим временем»: длина встречи и кто должен прийти.
 * Раньше они жили в боковой карточке «Общие окна», хотя меняют всю вкладку —
 * и «Лучшее время», и карту, и окна. Наведение на имя подсвечивает на карте,
 * когда этот человек свободен (как в When2meet).
 */
export function PickBar({
  chosenDuration,
  durationOptions,
  onDuration,
  people,
  selected,
  onSelected,
  spot,
  onSpot,
  loading,
  labels,
}: {
  /** Длина в списке: пока идёт запрос, она уже новая, а варианты ещё прежние. */
  chosenDuration: number;
  durationOptions: number[];
  onDuration: (minutes: number) => void;
  people: BoardPayload["people"];
  selected: number[] | null;
  onSelected: (next: number[] | null) => void;
  spot: number | null;
  onSpot: (id: number | null) => void;
  loading: boolean;
  labels: BoardLabels;
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

  return (
    <section className="card pick-bar" aria-busy={loading}>
      <div className="field pick-duration">
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
        <div className="field pick-who">
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
          <ul className="who-chips" aria-labelledby="who-label">
            {people.map((person) => (
              <li
                key={person.id}
                onMouseEnter={person.filled ? () => onSpot(person.id) : undefined}
                onMouseLeave={person.filled ? () => onSpot(null) : undefined}
                onFocus={person.filled ? () => onSpot(person.id) : undefined}
                onBlur={person.filled ? () => onSpot(null) : undefined}
              >
                <label
                  className={`who-chip${isOn(person.id) ? " on" : ""}${person.filled ? "" : " off"}${spot === person.id ? " spotted" : ""}`}
                  title={person.filled ? undefined : labels.notFilled}
                >
                  <input
                    type="checkbox"
                    checked={isOn(person.id)}
                    disabled={!person.filled}
                    onChange={() => togglePerson(person.id)}
                  />
                  <span className="who-name">{person.name}</span>
                </label>
              </li>
            ))}
          </ul>
          <p className="small muted who-hint">{labels.whoHint}</p>
        </div>
      )}
    </section>
  );
}
