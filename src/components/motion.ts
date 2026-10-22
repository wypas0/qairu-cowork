"use client";

import { type RefObject, useEffect, useLayoutEffect, useState } from "react";

/* Движение интерфейса в коде: уход слоёв, подложка выбранного сегмента и
   смена содержимого на месте. Оформление и ключевые кадры — в
   src/styles/motion.css; правило одно — движение только в ответ на
   действие человека, при загрузке страницы ничего не едет. */

/** Сколько доигрывает уход слоя — как --dur-exit в tokens.css. */
export const EXIT_MS = 180;

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)"; // --ease

/** Человек просит меньше движения — слои убираются сразу, содержимое не едет. */
export function calm(): boolean {
  return typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Слой — окно, шторка, меню — уходит не мгновенно, а доигрывает уход.
 *
 * `value` — что показать, `null` — закрыто. После закрытия хук ещё
 * EXIT_MS держит последнее значение и отвечает `leaving: true`: слой в это
 * время помечается `data-leaving` и `inert` (уже не нажимается и не держит
 * фокус), а CSS играет уход. Открыли снова, пока уходил, — слой остаётся.
 */
export function useExit<T>(value: T | null): { shown: T | null; leaving: boolean } {
  const [shown, setShown] = useState<T | null>(value);
  const [leaving, setLeaving] = useState(false);
  if (value !== null && (value !== shown || leaving)) {
    setShown(value);
    setLeaving(false);
  } else if (value === null && shown !== null && !leaving) {
    setLeaving(true);
  }

  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(
      () => {
        setShown(null);
        setLeaving(false);
      },
      calm() ? 0 : EXIT_MS,
    );
    return () => clearTimeout(timer);
  }, [leaving]);

  return { shown, leaving };
}

/** Карточку только что открыли (приходит снизу) или закрыли (доигрывает уход). */
export type CardMotion = "enter" | "leaving";

/** Атрибуты для motion.css: `data-enter`, `data-leaving` и `inert` у уходящей. */
export function cardMotion(motion: CardMotion | undefined) {
  return {
    "data-enter": motion === "enter" ? "up" : undefined,
    "data-leaving": motion === "leaving" ? "" : undefined,
    inert: motion === "leaving" || undefined,
  };
}

/** Выбранный сегмент: вкладка, вариант, день. */
const SELECTED = ':scope > [aria-selected="true"], :scope > [aria-checked="true"], :scope > .active';

/**
 * Подложка выбранного сегмента скользит к новому, а не перепрыгивает.
 *
 * Меряем выбранную кнопку и пишем её место в CSS-переменные контейнера;
 * рисует подложку `[data-thumb]::before`. Первый замер — без движения
 * (`data-thumb="on"`), скольжение включается со следующего кадра (`"live"`).
 * Пока замера нет — разметка с сервера, — выбранная кнопка залита сама,
 * поэтому при загрузке ничего не мигает и не сдвигается.
 *
 * `selected` — что сейчас выбрано: сменилось — подложка переезжает.
 */
export function useThumb(ref: RefObject<HTMLElement | null>, selected: unknown) {
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    const item = box.querySelector<HTMLElement>(SELECTED);
    if (!item) {
      delete box.dataset.thumb;
      return;
    }
    let frame = 0;
    let placed = false;
    // glide — скользить к кнопке; иначе встать на место сразу и включить
    // скольжение со следующего кадра. offset* не видят transform: нажатая
    // кнопка ужата (scale 0.97), а подложка встаёт по настоящему размеру.
    const place = (glide: boolean) => {
      // Контейнер скрыт (телефонный вид на компьютере) — замерим, когда покажется.
      if (!item.offsetWidth) return;
      placed = true;
      if (!glide) box.dataset.thumb = "on";
      box.style.setProperty("--thumb-x", `${item.offsetLeft}px`);
      box.style.setProperty("--thumb-y", `${item.offsetTop}px`);
      box.style.setProperty("--thumb-w", `${item.offsetWidth}px`);
      box.style.setProperty("--thumb-h", `${item.offsetHeight}px`);
      box.style.setProperty("--thumb-r", getComputedStyle(item).borderRadius);
      // Ряд не влез и листается (320 px) — выбранная вкладка не прячется за краем.
      if (box.scrollWidth > box.clientWidth) {
        const left = item.offsetLeft - 8;
        const right = item.offsetLeft + item.offsetWidth + 8 - box.clientWidth;
        const target = box.scrollLeft > left ? left : box.scrollLeft < right ? right : null;
        if (target !== null) box.scrollTo({ left: target, behavior: glide && !calm() ? "smooth" : "auto" });
      }
      if (box.dataset.thumb === "live") return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        box.dataset.thumb = "live";
      });
    };
    // Сменился выбор — подложка едет; первый замер — встаёт без движения.
    place(box.dataset.thumb === "live");
    // Размер кнопок поменялся сам — подгрузился шрифт, появился счётчик,
    // контейнер стал видимым, повернули экран: подложка встаёт без движения.
    // Первый вызов наблюдателя приходит сразу после observe — его пропускаем
    // (если подложка уже стоит), иначе он оборвал бы только что начатое скольжение.
    let first = true;
    const observer = new ResizeObserver(() => {
      const skip = first && placed;
      first = false;
      if (!skip) place(false);
    });
    observer.observe(box);
    observer.observe(item);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [ref, selected]);
}

/**
 * Новое содержимое на том же месте — другая вкладка, неделя, день —
 * приходит с той стороны, куда переключили: 1 — вперёд (справа),
 * -1 — назад (слева), 0 — снизу. Только прозрачность и сдвиг: макет не
 * пересчитывается, соседи не прыгают.
 */
export function slideIn(node: Element | null | undefined, direction: 1 | -1 | 0) {
  if (!node || calm() || typeof node.animate !== "function") return;
  const from = direction === 0 ? "translateY(8px)" : `translateX(${direction * 16}px)`;
  node.animate([{ opacity: 0, transform: from }, { opacity: 1, transform: "none" }], {
    duration: 260,
    easing: EASE,
  });
}
