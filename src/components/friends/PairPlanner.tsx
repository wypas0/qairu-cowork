"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { type Interval, fmtInterval, fmtMinutes } from "@/core/intervals";
import { PAIR_PLAN, openWindows, parsePickedWhen, startOptions, suggestStarts, withoutBooked } from "@/core/pairPlan";
import type { DateStr } from "@/core/timeutils";
import { PICK_EVENT, type PickDetail } from "../pick";
import { useThumb } from "../motion";

export type PlanDayView = {
  day: DateStr;
  /** «Ср 28.10» — на языке страницы. */
  label: string;
  /** Когда оба свободны; null — неизвестно (скрыто или расписания нет). */
  windows: Interval[] | null;
  /** Уже назначенные встречи с этим другом — розовым на полоске. */
  meetings: Interval[];
};

export type PairPlannerLabels = {
  duration: string;
  week: string;
  suggest: string;
  day: string;
  start: string;
  /** «Выбери день и время» — пока ничего не выбрано. */
  choose: string;
  dayNone: string;
  dayShort: string;
  anyTime: string;
  goal: string;
  goalPh: string;
  place: string;
  placePh: string;
  repeat: string;
  repeatUntil: string;
  submit: string;
  durationTemplate: string;
  hoursOnlyTemplate: string;
  minutesTemplate: string;
};

const SPAN = PAIR_PLAN.dayEnd - PAIR_PLAN.dayStart;
/** Где на полоске дня стоит время: доля от 8:00 до 22:00. */
const at = (minutes: number) => `${((minutes - PAIR_PLAN.dayStart) / SPAN) * 100}%`;
const width = ([from, to]: Interval) => `${((to - from) / SPAN) * 100}%`;
const TICKS = [8, 12, 16, 20, 22];
const WEEK = 7;

function durationText(minutes: number, labels: PairPlannerLabels): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return labels.minutesTemplate.replace("{m}", String(m));
  if (m === 0) return labels.hoursOnlyTemplate.replace("{h}", String(h));
  return labels.durationTemplate.replace("{h}", String(h)).replace("{m}", String(m));
}

/** Та же дата через `weeks` недель — серия по умолчанию идёт около семестра. */
function addWeeks(date: string, weeks: number): string {
  const moment = new Date(`${date}T12:00:00Z`);
  moment.setUTCDate(moment.getUTCDate() + weeks * 7);
  return moment.toISOString().slice(0, 10);
}

/**
 * Назначить встречу другу — не текстом, а выбором, как в группе: длина
 * кнопками, неделя, готовые варианты сверху, дальше день (строка с
 * полоской 8–22, где закрашено общее свободное время) и время начала
 * кнопками под выбранным днём. Выбранное — словами над кнопкой и отрезком
 * на полоске. Дни, где на такую длину общего времени нет, неактивны.
 *
 * Общее время неизвестно (скрыто настройками или нет расписания) — те же
 * кнопки, только доступны все часы 8–22.
 *
 * «Повторить» у прошедшей встречи (событие PICK_EVENT) подставляет день,
 * время, длину, цель и место.
 */
export function PairPlanner({
  days,
  today,
  todayFrom,
  action,
  extra,
  labels,
}: {
  days: PlanDayView[];
  today: DateStr;
  /** «Сейчас» в минутах — сегодня раньше начать нельзя. */
  todayFrom: number;
  action: (formData: FormData) => void;
  /** Рядом с главной кнопкой — «Скопировать» окна текстом. */
  extra?: React.ReactNode;
  labels: PairPlannerLabels;
}) {
  const [duration, setDuration] = useState<number>(PAIR_PLAN.defaultDuration);
  const [week, setWeek] = useState(0);
  const [day, setDay] = useState<DateStr | null>(null);
  const [start, setStart] = useState<number | null>(null);
  const [repeat, setRepeat] = useState(false);
  const [preset, setPreset] = useState({ goal: "", place: "", version: 0 });
  const durationsRef = useRef<HTMLDivElement>(null);
  const weeksRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const goalRef = useRef<HTMLInputElement>(null);
  useThumb(durationsRef, duration);
  useThumb(weeksRef, week);

  // Окна каждого дня: общие или (неизвестно) весь день 8–22, без ваших уже
  // назначенных встреч; начала — под выбранную длину.
  const plan = useMemo(
    () =>
      days.map((entry) => {
        const windows = withoutBooked(entry.windows ?? openWindows(entry.day, today, todayFrom), entry.meetings);
        return { ...entry, usable: windows, starts: startOptions(windows, duration) };
      }),
    [days, today, todayFrom, duration],
  );
  const known = days.some((entry) => entry.windows !== null);
  const weeks = [plan.slice(0, WEEK), plan.slice(WEEK, WEEK * 2)].filter((part) => part.length > 0);
  const shown = weeks[week] ?? weeks[0] ?? [];
  const suggestions = known
    ? suggestStarts(
        plan.map(({ day: date, usable }) => ({ day: date, windows: usable })),
        duration,
      )
    : [];
  const chosenDay = plan.find((entry) => entry.day === day) ?? null;
  const chosen = chosenDay && start !== null && chosenDay.starts.includes(start) ? { day: chosenDay, start } : null;

  function pick(date: DateStr, minutes: number | null) {
    setDay(date);
    setStart(minutes);
    const index = plan.findIndex((entry) => entry.day === date);
    if (index >= 0) setWeek(Math.floor(index / WEEK));
  }

  function changeDuration(next: number) {
    setDuration(next);
    // Прежнее начало с новой длиной не влезает — выбор начала сбрасывается, день остаётся.
    const entry = plan.find((item) => item.day === day);
    if (entry && start !== null && !startOptions(entry.usable, next).includes(start)) setStart(null);
  }

  useEffect(() => {
    function onPick(event: Event) {
      const { detail } = event as CustomEvent<PickDetail>;
      const when = parsePickedWhen(detail.value);
      if (when) {
        setDuration(when.duration);
        const index = days.findIndex((entry) => entry.day === when.day);
        if (index >= 0) {
          setDay(when.day);
          setStart(when.start);
          setWeek(Math.floor(index / WEEK));
        }
      }
      setPreset((current) => ({ goal: detail.goal ?? "", place: detail.place ?? "", version: current.version + 1 }));
      requestAnimationFrame(() => {
        formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        goalRef.current?.focus({ preventScroll: true });
      });
    }
    window.addEventListener(PICK_EVENT, onPick);
    return () => window.removeEventListener(PICK_EVENT, onPick);
  }, [days]);

  const durations: number[] = [...PAIR_PLAN.durations];
  if (!durations.includes(duration)) durations.push(duration);
  durations.sort((a, b) => a - b);

  return (
    <form ref={formRef} action={action} className="pp-form">
      <input type="hidden" name="when" value={chosen ? `${chosen.day.day}T${fmtMinutes(chosen.start)}|${duration}` : ""} />

      <div className="pp-controls">
        <div className="field">
          <span className="label" id="pp-duration">
            {labels.duration}
          </span>
          <div className="seg" role="radiogroup" aria-labelledby="pp-duration" ref={durationsRef}>
            {durations.map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={value === duration}
                className={value === duration ? "active" : undefined}
                onClick={() => changeDuration(value)}
              >
                {durationText(value, labels)}
              </button>
            ))}
          </div>
        </div>
        {weeks.length > 1 && (
          <div className="field">
            <span className="label" id="pp-week">
              {labels.week}
            </span>
            <div className="seg" role="radiogroup" aria-labelledby="pp-week" ref={weeksRef}>
              {weeks.map((part, index) => (
                <button
                  key={part[0]!.day}
                  type="button"
                  role="radio"
                  aria-checked={index === week}
                  className={index === week ? "active" : undefined}
                  onClick={() => setWeek(index)}
                >
                  {`${part[0]!.label.split(" ").pop()}–${part[part.length - 1]!.label.split(" ").pop()}`}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {suggestions.length > 0 && (
        <div className="field pp-suggest">
          <span className="label" id="pp-suggest">
            {labels.suggest}
          </span>
          <div className="daypicker" aria-labelledby="pp-suggest">
            {suggestions.map((option) => {
              const label = plan.find((entry) => entry.day === option.day)?.label ?? option.day;
              const active = chosen?.day.day === option.day && chosen.start === option.start;
              return (
                <button
                  key={option.day}
                  type="button"
                  className={`daychip${active ? " active" : ""}`}
                  aria-pressed={active}
                  onClick={() => pick(option.day, option.start)}
                >
                  {label} · {fmtMinutes(option.start)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <span className="label" id="pp-day">
        {labels.day}
      </span>
      {known && (
        <div className="fr-axis" aria-hidden="true">
          {TICKS.map((hour) => (
            <span key={hour} style={{ left: at(hour * 60) }}>
              {hour}
            </span>
          ))}
        </div>
      )}
      <div className="pp-days" role="radiogroup" aria-labelledby="pp-day">
        {shown.map((entry) => {
          const selected = entry.day === day;
          const fits = entry.usable.filter(([from, to]) => to - from >= duration);
          const disabled = entry.starts.length === 0;
          const times = entry.windows === null
            ? labels.anyTime
            : fits.length
              ? fits.map((window) => fmtInterval(window)).join(", ")
              : entry.usable.length
                ? labels.dayShort
                : labels.dayNone;
          return (
            <div className={`pp-day-row${selected ? " selected" : ""}`} key={entry.day}>
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={disabled}
                className="pp-day"
                onClick={() => pick(entry.day, null)}
              >
                <span className="fr-day">{entry.label}</span>
                {/* Полоска дня 8–22: синим — оба свободны, розовым — ваши встречи, контуром — выбранное. */}
                <span className={`fr-strip${entry.windows === null ? " unknown" : ""}`} aria-hidden="true">
                  {(entry.windows ?? []).map((window) => (
                    <i key={window[0]} style={{ left: at(window[0]), width: width(window) }} />
                  ))}
                  {entry.meetings.map((span) => (
                    <i className="meet" key={`m${span[0]}`} style={{ left: at(span[0]), width: width(span) }} />
                  ))}
                  {chosen && chosen.day.day === entry.day && (
                    <i className="chosen" style={{ left: at(chosen.start), width: width([chosen.start, chosen.start + duration]) }} />
                  )}
                </span>
                <span className={disabled ? "fr-day-times muted" : "fr-day-times"}>{times}</span>
              </button>
              {selected && !disabled && (
                <div className="pp-starts" role="radiogroup" aria-label={`${labels.start}: ${entry.label}`} data-enter="up">
                  {entry.starts.map((minutes) => (
                    <button
                      key={minutes}
                      type="button"
                      role="radio"
                      aria-checked={start === minutes}
                      className={`daychip${start === minutes ? " active" : ""}`}
                      onClick={() => setStart(minutes)}
                    >
                      {fmtMinutes(minutes)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className={`pp-chosen${chosen ? "" : " muted"}`} aria-live="polite">
        {chosen ? `${chosen.day.label} · ${fmtInterval([chosen.start, chosen.start + duration])}` : labels.choose}
      </p>

      <div className="pp-fields">
        <div className="field">
          <label htmlFor="pp-goal">{labels.goal}</label>
          <input
            ref={goalRef}
            key={`goal-${preset.version}`}
            id="pp-goal"
            name="goal"
            type="text"
            maxLength={300}
            placeholder={labels.goalPh}
            defaultValue={preset.goal}
          />
        </div>
        <div className="field">
          <label htmlFor="pp-place">{labels.place}</label>
          <input
            key={`place-${preset.version}`}
            id="pp-place"
            name="place"
            type="text"
            maxLength={200}
            placeholder={labels.placePh}
            defaultValue={preset.place}
          />
        </div>
      </div>
      <div className="field">
        <label className="checkbox">
          <input type="checkbox" name="repeat" checked={repeat} onChange={(event) => setRepeat(event.target.checked)} />
          <span>{labels.repeat}</span>
        </label>
        {repeat && (
          <div className="repeat-until">
            <label htmlFor="pp-repeat-until">{labels.repeatUntil}</label>
            <input
              id="pp-repeat-until"
              name="repeat_until"
              type="date"
              min={chosen?.day.day ?? today}
              defaultValue={addWeeks(chosen?.day.day ?? today, 12)}
              required
            />
          </div>
        )}
      </div>

      <div className="dated-actions">
        <button className="btn btn-primary" type="submit" disabled={!chosen}>
          {labels.submit}
        </button>
        {extra}
      </div>
    </form>
  );
}
