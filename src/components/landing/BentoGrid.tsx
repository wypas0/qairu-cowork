"use client";

import { useEffect, useRef } from "react";

import { calm } from "../motion";

/**
 * Сетка «Что внутри» и мягкое пятно света за курсором внутри плитки.
 * Один обработчик `pointermove` на всю сетку: место курсора пишется в
 * `--mx/--my` плитки под ним (раз в кадр), пятно рисует `.tile::before`
 * через translate. Только мышь; при «меньше движения» пятна нет.
 */
export function BentoGrid({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const grid = ref.current;
    if (!grid || calm()) return;
    let frame = 0;
    let tile: HTMLElement | null = null;
    let x = 0;
    let y = 0;
    const write = () => {
      frame = 0;
      tile?.style.setProperty("--mx", `${Math.round(x)}px`);
      tile?.style.setProperty("--my", `${Math.round(y)}px`);
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const target = (event.target as Element | null)?.closest<HTMLElement>(".tile");
      if (!target) return;
      const rect = target.getBoundingClientRect();
      tile = target;
      x = event.clientX - rect.left;
      y = event.clientY - rect.top;
      if (!frame) frame = requestAnimationFrame(write);
    };
    grid.addEventListener("pointermove", move, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      grid.removeEventListener("pointermove", move);
    };
  }, []);

  return (
    <div className="bento" ref={ref}>
      {children}
    </div>
  );
}
