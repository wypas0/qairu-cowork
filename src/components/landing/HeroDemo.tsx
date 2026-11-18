"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { ALL_IDS, DEMO_PEOPLE, DEMO_PERIODS, bestWindow, freeCounts, freeOfAll, heatClass } from "@/core/landingDemo";
import { initials } from "../friends/initials";
import { calm, slideIn } from "../motion";

export type HeroDemoLabels = {
  /** Пн…Пт на языке страницы. */
  days: string[];
  /** Подпись таблицы для скринридера. */
  caption: string;
  /** Подпись ряда людей. */
  people: string;
  /** «свободны все». */
  all: string;
  /** «свободны n из 8» для n = 0…8 — формы посчитаны на сервере. */
  freeOf: string[];
  /** Строка для aria-live: {n}, {day}, {time}, {free}. */
  live: string;
  /** Подсказка последнему включённому: {name}. */
  last: string;
  hint: string;
  legendAll: string;
  legendNone: string;
};

/**
 * Витрина лендинга (Л1): карта недели выдуманной группы, которой можно
 * пошевелить. Нажатие на человека — его больше не считаем: клетки
 * пересчитываются, кольцо лучшего окна переезжает, время в карточке
 * приходит снизу. Наведение и фокус на человеке гасят клетки, где он занят, —
 * как на настоящей карте группы.
 *
 * Разметка с сервера полная (все восемь включены), до гидратации кольцо
 * рисует сама клетка (`td.best`): после гидратации его сменяет отдельный
 * слой — без сдвига. Тексты приходят готовыми с сервера: словари в браузер
 * не едут.
 */
export function HeroDemo({ labels }: { labels: HeroDemoLabels }) {
  const [active, setActive] = useState<ReadonlySet<number>>(ALL_IDS);
  const [spot, setSpot] = useState<number | null>(null);
  const [live, setLive] = useState("");
  const mapRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLSpanElement>(null);
  const bestRef = useRef<HTMLDivElement>(null);
  const touched = useRef(false);

  const counts = freeCounts(active);
  const best = bestWindow(active)!;
  const period = DEMO_PERIODS[best.period];
  const freeAll = freeOfAll(best.period, best.day);
  const freeText = freeAll === DEMO_PEOPLE.length ? labels.all : labels.freeOf[freeAll];
  const bestKey = `${best.period}:${best.day}`;
  const spotted = spot === null ? null : DEMO_PEOPLE[spot];

  // Кольцо лучшего окна — отдельный слой поверх таблицы: меряем клетку и
  // ставим слой через translate. Первый замер — без движения; переезд к
  // новой клетке — с переходом (data-ring="live"). Размер карты поменялся
  // сам (шрифт, поворот экрана) — встаёт на место без движения.
  useLayoutEffect(() => {
    const map = mapRef.current;
    const ring = ringRef.current;
    const cell = map?.querySelector<HTMLElement>("td.best");
    if (!map || !ring || !cell) return;
    let frame = 0;
    const place = (glide: boolean) => {
      const box = map.getBoundingClientRect();
      const rect = cell.getBoundingClientRect();
      if (!rect.width) return;
      if (!glide) map.dataset.ring = "on";
      ring.style.setProperty("--ring-x", `${rect.left - box.left}px`);
      ring.style.setProperty("--ring-y", `${rect.top - box.top}px`);
      ring.style.setProperty("--ring-w", `${rect.width}px`);
      ring.style.setProperty("--ring-h", `${rect.height}px`);
      if (map.dataset.ring === "live") return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        map.dataset.ring = "live";
      });
    };
    place(map.dataset.ring === "live");
    let first = true;
    const observer = new ResizeObserver(() => {
      if (!first) place(false);
      first = false;
    });
    observer.observe(map);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [bestKey]);

  // Новое время приходит снизу — только после нажатия, не при загрузке.
  useEffect(() => {
    if (touched.current) slideIn(bestRef.current, 0);
  }, [bestKey]);

  // Небо витрины чуть сдвигается за указателем (до 8 px) — только мышью на
  // широком экране и не при «меньше движения». Пишем раз в кадр.
  useEffect(() => {
    const hero = mapRef.current?.closest<HTMLElement>(".hero");
    if (!hero || calm()) return;
    const wide = window.matchMedia("(hover: hover) and (min-width: 900px)");
    let frame = 0;
    let x = 0;
    let y = 0;
    const write = () => {
      frame = 0;
      hero.style.setProperty("--mx", `${x.toFixed(1)}px`);
      hero.style.setProperty("--my", `${y.toFixed(1)}px`);
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || !wide.matches) return;
      const rect = hero.getBoundingClientRect();
      x = ((event.clientX - rect.left) / rect.width - 0.5) * 16;
      y = ((event.clientY - rect.top) / rect.height - 0.5) * 16;
      if (!frame) frame = requestAnimationFrame(write);
    };
    const leave = () => {
      x = 0;
      y = 0;
      if (!frame) frame = requestAnimationFrame(write);
    };
    hero.addEventListener("pointermove", move, { passive: true });
    hero.addEventListener("pointerleave", leave);
    return () => {
      cancelAnimationFrame(frame);
      hero.removeEventListener("pointermove", move);
      hero.removeEventListener("pointerleave", leave);
    };
  }, []);

  function toggle(id: number) {
    if (active.has(id) && active.size === 1) return;
    const next = new Set(active);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    touched.current = true;
    setActive(next);
    const found = bestWindow(next)!;
    const time = `${DEMO_PERIODS[found.period].start}–${DEMO_PERIODS[found.period].end}`;
    const all = freeOfAll(found.period, found.day);
    setLive(
      labels.live
        .replace("{n}", String(next.size))
        .replace("{day}", labels.days[found.day])
        .replace("{time}", time)
        .replace("{free}", all === DEMO_PEOPLE.length ? labels.all : labels.freeOf[all]),
    );
  }

  return (
    <div className="demo hero-demo">
      <ul className="who-avatars demo-who" aria-label={labels.people}>
        {DEMO_PEOPLE.map((person) => {
          const on = active.has(person.id);
          const last = on && active.size === 1;
          return (
            <li key={person.id}>
              <button
                type="button"
                className={`who-avatar${on ? " on" : ""}${spot === person.id ? " spotted" : ""}`}
                aria-pressed={on}
                aria-disabled={last || undefined}
                title={last ? labels.last.replace("{name}", person.name) : person.name}
                onClick={() => toggle(person.id)}
                onMouseEnter={() => setSpot(person.id)}
                onMouseLeave={() => setSpot(null)}
                onFocus={() => setSpot(person.id)}
                onBlur={() => setSpot(null)}
              >
                <span className="who-avatar-mark" aria-hidden="true">
                  {initials(person.name)}
                </span>
                <span className="who-avatar-name">{person.name}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="demo-best" ref={bestRef} key={bestKey}>
        <span className="type-title-3">
          {period.start}–{period.end}
        </span>
        <span className="small muted">
          {labels.days[best.day]} · {freeText}
        </span>
      </div>

      <div className="demo-map" ref={mapRef}>
        <table className={`week periods demo-week${spotted ? " spotting" : ""}`}>
          <caption className="sr-only">{labels.caption}</caption>
          <thead>
            <tr>
              <th className="timecol" />
              {labels.days.map((day) => (
                <th key={day} scope="col">
                  {day}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DEMO_PERIODS.map((row, index) => (
              <tr key={row.n}>
                <td className="timecol period">
                  <span className="period-line">
                    <b className="period-n">{row.n}</b>
                    <span className="period-start">{row.start}</span>
                  </span>
                </td>
                {counts[index].map((count, day) => {
                  const isBest = index === best.period && day === best.day;
                  const dim = spotted?.busy[index][day] ? " spot-off" : "";
                  return (
                    <td className={`cell ${heatClass(count, active.size)}${isBest ? " best" : ""}${dim}`} key={day}>
                      <span className="sr-only">{count}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <span className="demo-ring" ref={ringRef} aria-hidden="true" />
      </div>

      <div className="legend" aria-hidden="true">
        <span>{labels.legendAll}</span>
        {["h0", "h1", "h2", "h3", "h4", "h5"].map((cls) => (
          <i key={cls} className={cls} />
        ))}
        <span>{labels.legendNone}</span>
      </div>
      <p className="small muted demo-hint">{labels.hint}</p>
      <p className="sr-only" aria-live="polite">
        {live}
      </p>
    </div>
  );
}
