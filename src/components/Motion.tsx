"use client";

import { useEffect } from "react";

/**
 * Два поведения движения на весь сайт — без разметки и без зависимостей.
 *
 * 1. Плашка выбора скользит к выбранному пункту (Kinetics, Tab Pill Glide):
 *    разделы группы и кисть редактора. Плашку рисует CSS (`.glides::before`),
 *    здесь только меряем выбранный пункт и кладём его место в переменные.
 *    Без JS работает прежняя заливка самого пункта — ничего не теряется.
 * 2. Зацикленные рисунки (`[data-loop]`) замирают, когда их не видно:
 *    атрибут `data-offscreen` ставит паузу CSS-анимациям.
 *
 * Ничего не рисует.
 */

const SEGMENTED = ".tabs, .brush";
const CHOSEN = '[aria-selected="true"], [aria-checked="true"]';

function place(box: HTMLElement) {
  const chosen = box.querySelector<HTMLElement>(CHOSEN);
  if (!chosen) {
    box.classList.remove("glides");
    return;
  }
  box.style.setProperty("--glide-x", `${chosen.offsetLeft}px`);
  box.style.setProperty("--glide-y", `${chosen.offsetTop}px`);
  box.style.setProperty("--glide-w", `${chosen.offsetWidth}px`);
  box.style.setProperty("--glide-h", `${chosen.offsetHeight}px`);
  // Первая раскладка — без скольжения: плашка просто стоит на месте.
  if (!box.classList.contains("glides")) {
    box.classList.add("glides", "glide-still");
    requestAnimationFrame(() => box.classList.remove("glide-still"));
  }
}

export function Motion() {
  useEffect(() => {
    const sizes = new ResizeObserver((entries) => {
      for (const entry of entries) place(entry.target as HTMLElement);
    });
    const loops = new IntersectionObserver((entries) => {
      for (const entry of entries) entry.target.toggleAttribute("data-offscreen", !entry.isIntersecting);
    });
    const known = new WeakSet<Element>();

    function scan() {
      document.querySelectorAll<HTMLElement>(SEGMENTED).forEach((box) => {
        if (!known.has(box)) {
          known.add(box);
          sizes.observe(box);
        }
        place(box);
      });
      document.querySelectorAll("[data-loop]").forEach((el) => {
        if (known.has(el)) return;
        known.add(el);
        loops.observe(el);
      });
    }

    // Новые узлы (клиентский переход, подсказка карты) — пересканировать не чаще кадра.
    let queued = 0;
    const rescan = () => {
      if (!queued) queued = requestAnimationFrame(() => ((queued = 0), scan()));
    };

    // Выбор меняется атрибутом, а страницы — клиентскими переходами: следим за обоими.
    const changes = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "childList") {
          rescan();
          continue;
        }
        const box = (record.target as Element).closest<HTMLElement>(SEGMENTED);
        if (box) place(box);
      }
    });
    changes.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-selected", "aria-checked"],
    });

    scan();
    return () => {
      cancelAnimationFrame(queued);
      changes.disconnect();
      sizes.disconnect();
      loops.disconnect();
    };
  }, []);

  return null;
}
