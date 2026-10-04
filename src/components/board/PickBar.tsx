"use client";

import { useEffect, useRef, useState } from "react";

import type { BoardPayload } from "@/lib/group";
import { IconChevronRight } from "../icons";
import { type BoardLabels, durationText } from "./labels";

/** До стольких людей — кружки в ряд; больше — одна кнопка со списком и поиском. */
const AVATAR_LIMIT = 10;

type Person = BoardPayload["people"][number];

/** Две первые буквы имени: «Амир» → «Ам», «Асель» → «Ас» — двоих на «А» не спутать. */
export function initials(name: string): string {
  const word = name.trim().split(/\s+/)[0] ?? "";
  const letters = [...word];
  return letters.length === 0 ? "?" : (letters[0]!.toUpperCase() + (letters[1] ?? "").toLowerCase());
}

/**
 * Полоса подбора над доской: длина встречи и кто должен прийти. Меняет всю
 * вкладку — «Лучшее время», «Общие окна» и карту.
 *
 * Длительность — кнопками (одно нажатие вместо раскрытия списка). Люди — до
 * десяти кружками с инициалами, как участники у встреч: нажатие включает и
 * выключает, наведение подсвечивает на карте, когда человек свободен. В
 * больших группах ряд кружков превратился бы в стену — там одна кнопка со
 * списком и поиском. На узком экране (телефон, увеличение 150–200%) вся
 * полоса сворачивается в строку-сводку и раскрывается нажатием.
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
  /** Длина в кнопках: пока идёт запрос, она уже новая, а варианты ещё прежние. */
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
  const [open, setOpen] = useState(false);
  // Не заполнившие в расчёт не попадают — про них неизвестно, свободны ли они.
  const filledIds = people.filter((person) => person.filled).map((person) => person.id);
  const isOn = (id: number) => (selected === null ? filledIds.includes(id) : selected.includes(id));
  const chosenCount = selected === null ? filledIds.length : selected.length;
  const off = people.filter((person) => person.filled && !isOn(person.id)).map((person) => person.name);

  function togglePerson(id: number) {
    const current = selected ?? filledIds;
    const next = current.includes(id) ? current.filter((other) => other !== id) : [...current, id];
    // Хотя бы один человек должен остаться — иначе считать нечего.
    if (next.length === 0) return;
    onSelected(next.length === filledIds.length ? null : next);
  }

  const whoTitle = labels.whoNeeded.replace("{n}", String(chosenCount)).replace("{total}", String(filledIds.length));
  const summary = [durationText(chosenDuration, labels), off.length > 0 ? labels.whoWithout.replace("{names}", off.join(", ")) : labels.whoEveryone].join(" · ");

  return (
    <section className={`card pick-bar${open ? " open" : ""}`} aria-busy={loading}>
      {/* Узкий экран: одна строка-сводка вместо всей полосы. */}
      <button type="button" className="pick-summary" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="pick-summary-text">{summary}</span>
        <IconChevronRight size={16} className="pick-summary-icon" />
      </button>

      <div className="pick-body">
        <div className="field pick-duration">
          <span className="label" id="duration-label">
            {labels.duration}
          </span>
          <div className="seg" role="radiogroup" aria-labelledby="duration-label">
            {durationOptions.map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={value === chosenDuration}
                className={value === chosenDuration ? "active" : undefined}
                onClick={() => onDuration(value)}
              >
                {durationText(value, labels)}
              </button>
            ))}
          </div>
        </div>

        {people.length > 1 && (
          <div className="field pick-who">
            <div className="who-head">
              <span className="label" id="who-label">
                {whoTitle}
              </span>
              <details className="pick-help">
                <summary aria-label={labels.whoHelp} title={labels.whoHelp}>
                  ?
                </summary>
                <p className="small">{labels.whoHint}</p>
              </details>
              {selected !== null && (
                <button type="button" className="btn btn-sm btn-quiet" onClick={() => onSelected(null)}>
                  {labels.whoAll}
                </button>
              )}
            </div>
            {people.length <= AVATAR_LIMIT ? (
              <ul className="who-avatars" aria-labelledby="who-label">
                {people.map((person) => (
                  <li key={person.id}>
                    <AvatarToggle
                      person={person}
                      on={isOn(person.id)}
                      spotted={spot === person.id}
                      notFilled={labels.notFilled}
                      onToggle={() => togglePerson(person.id)}
                      onSpot={onSpot}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <PeoplePicker
                people={people}
                isOn={isOn}
                chosenCount={chosenCount}
                total={filledIds.length}
                spot={spot}
                labels={labels}
                onToggle={togglePerson}
                onAll={() => onSelected(null)}
                onSpot={onSpot}
              />
            )}
            {off.length > 0 && <p className="small muted who-off">{labels.whoWithout.replace("{names}", off.join(", "))}</p>}
          </div>
        )}
      </div>
    </section>
  );
}

/** Кружок человека: инициалы и имя под ними. Не заполнивший — пунктиром, нажать нельзя. */
function AvatarToggle({
  person,
  on,
  spotted,
  notFilled,
  onToggle,
  onSpot,
}: {
  person: Person;
  on: boolean;
  spotted: boolean;
  notFilled: string;
  onToggle: () => void;
  onSpot: (id: number | null) => void;
}) {
  const title = person.filled ? person.name : `${person.name}: ${notFilled}`;
  return (
    <button
      type="button"
      className={`who-avatar${on ? " on" : ""}${person.filled ? "" : " off"}${spotted ? " spotted" : ""}`}
      aria-pressed={person.filled ? on : undefined}
      disabled={!person.filled}
      title={title}
      aria-label={title}
      data-person={person.name}
      onClick={onToggle}
      onMouseEnter={person.filled ? () => onSpot(person.id) : undefined}
      onMouseLeave={person.filled ? () => onSpot(null) : undefined}
      onFocus={person.filled ? () => onSpot(person.id) : undefined}
      onBlur={person.filled ? () => onSpot(null) : undefined}
    >
      <span className="who-avatar-mark" aria-hidden="true">
        {initials(person.name)}
      </span>
      <span className="who-avatar-name">{person.name}</span>
    </button>
  );
}

/** Большая группа: кнопка со стопкой кружков, по нажатию — список с поиском. */
function PeoplePicker({
  people,
  isOn,
  chosenCount,
  total,
  spot,
  labels,
  onToggle,
  onAll,
  onSpot,
}: {
  people: Person[];
  isOn: (id: number) => boolean;
  chosenCount: number;
  total: number;
  spot: number | null;
  labels: BoardLabels;
  onToggle: (id: number) => void;
  onAll: () => void;
  onSpot: (id: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const shown = people.filter((person) => person.name.toLowerCase().includes(query.trim().toLowerCase()));
  const stack = people.filter((person) => person.filled && isOn(person.id)).slice(0, 4);

  return (
    <div className="who-picker" ref={root}>
      <button type="button" className="who-picker-btn" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="who-stack" aria-hidden="true">
          {stack.map((person) => (
            <span key={person.id}>{initials(person.name)}</span>
          ))}
        </span>
        <span>{chosenCount === total ? labels.whoEveryone : `${chosenCount} / ${total}`}</span>
        <IconChevronRight size={16} className="who-picker-icon" />
      </button>
      {open && (
        <div className="who-panel">
          <input
            type="search"
            id="who-search"
            value={query}
            placeholder={labels.whoSearch}
            aria-label={labels.whoSearch}
            onChange={(event) => setQuery(event.target.value)}
          />
          <ul className="who-rows">
            {shown.map((person) => (
              <li key={person.id}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={person.filled ? isOn(person.id) : false}
                  disabled={!person.filled}
                  className={`who-row-btn${spot === person.id ? " spotted" : ""}`}
                  data-person={person.name}
                  onClick={() => onToggle(person.id)}
                  onMouseEnter={person.filled ? () => onSpot(person.id) : undefined}
                  onMouseLeave={person.filled ? () => onSpot(null) : undefined}
                >
                  <span className="who-avatar-mark" aria-hidden="true">
                    {initials(person.name)}
                  </span>
                  <span className="who-row-name">
                    {person.name}
                    {!person.filled && <span className="small muted"> · {labels.notFilled}</span>}
                  </span>
                  <span className="who-switch" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          <div className="who-panel-foot">
            <button type="button" className="btn btn-sm btn-quiet" onClick={onAll}>
              {labels.whoAll}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>
              {labels.whoDone}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
