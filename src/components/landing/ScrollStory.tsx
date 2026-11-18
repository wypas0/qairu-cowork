"use client";

import { useEffect, useRef } from "react";

import { type ScrollRange, useScrollProgress } from "./useScrollProgress";

/** Высота липкой шапки над сценой — её пишет ScrollStory в `--story-top`. */
function storyTop(box: HTMLElement): number {
  return parseFloat(box.style.getPropertyValue("--story-top")) || 0;
}

/**
 * Сцена встаёт под шапку (0) и отпускается, когда низ секции дошёл до низа
 * сцены (1). Сцена — первый ребёнок секции.
 */
const STORY_RANGE: ScrollRange = {
  from: (box) => storyTop(box),
  to: (box) => storyTop(box) + ((box.firstElementChild as HTMLElement | null)?.offsetHeight ?? 0) - box.offsetHeight,
};

/**
 * Сцена прокрутки «Как складывается неделя» (Л2): высокая секция, внутри —
 * липкая сцена. Сама сцена — разметка с сервера (StoryScene); здесь только
 * прогресс `--p` и высота шапки, под которую сцена встаёт.
 *
 * Шапка `.topbar` липкая у гостя на любой ширине, у вошедшего — до 1024 px;
 * на компьютере у вошедшего её нет (display: none, высота 0). Высоту меряем,
 * а не зашиваем: в Telegram и при увеличении она другая.
 */
export function ScrollStory({ labelledBy, children }: { labelledBy: string; children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    const bar = document.querySelector<HTMLElement>(".topbar");
    const sync = () => {
      const sticky = bar !== null && getComputedStyle(bar).position === "sticky";
      box.style.setProperty("--story-top", `${sticky ? bar.offsetHeight : 0}px`);
    };
    sync();
    if (!bar) return;
    const observer = new ResizeObserver(sync);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  useScrollProgress(ref, STORY_RANGE);

  return (
    <section ref={ref} className="story" aria-labelledby={labelledBy}>
      {children}
    </section>
  );
}
