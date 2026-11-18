"use client";

import { type RefObject, useEffect } from "react";

import { calm } from "../motion";

/**
 * Где верх блока (в пикселях от верха окна), когда прогресс равен 0 и 1.
 * Функции держать на уровне модуля: новая функция на каждый рендер
 * перезапускала бы подписку.
 */
export type ScrollRange = {
  from: (box: HTMLElement, viewport: number) => number;
  to: (box: HTMLElement, viewport: number) => number;
};

/**
 * Прогресс прокрутки блока — CSS-переменная `--p` от 0 до 1 на самом блоке.
 *
 * Прокрутка — действие человека, поэтому то, что от неё зависит, движется
 * (правило «движение — только отклик»). Всё движение рисует CSS из `--p`:
 * переходов на этих свойствах нет, при загрузке ничего не едет, и
 * `document.getAnimations()` остаётся пустым. CSS-таймлайны прокрутки не
 * используются: один путь для всех браузеров.
 *
 * Обработчик `scroll` (passive, запись раз в кадр) подключён, только пока блок
 * в окне (IntersectionObserver); на это время у блока стоит `data-in-view`.
 * Ушёл из окна — последний замер дожимает `--p` до 0 или 1. При «меньше
 * движения» ничего не подключается: CSS показывает итог (`--p: 1`).
 */
export function useScrollProgress(ref: RefObject<HTMLElement | null>, range: ScrollRange) {
  useEffect(() => {
    const box = ref.current;
    if (!box || calm()) return;
    let frame = 0;
    let last = "";
    let listening = false;

    const apply = () => {
      frame = 0;
      const viewport = window.innerHeight;
      const from = range.from(box, viewport);
      const to = range.to(box, viewport);
      const top = box.getBoundingClientRect().top;
      const raw = from === to ? (top <= to ? 1 : 0) : (from - top) / (from - to);
      const value = Math.min(1, Math.max(0, raw)).toFixed(4);
      if (value === last) return;
      last = value;
      box.style.setProperty("--p", value);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const listen = (on: boolean) => {
      if (on === listening) return;
      listening = on;
      if (on) {
        window.addEventListener("scroll", schedule, { passive: true });
        window.addEventListener("resize", schedule);
        box.dataset.inView = "";
      } else {
        window.removeEventListener("scroll", schedule);
        window.removeEventListener("resize", schedule);
        delete box.dataset.inView;
      }
    };

    const observer = new IntersectionObserver(([entry]) => {
      listen(entry.isIntersecting);
      schedule();
    });
    observer.observe(box);
    return () => {
      observer.disconnect();
      listen(false);
      cancelAnimationFrame(frame);
    };
  }, [ref, range]);
}
