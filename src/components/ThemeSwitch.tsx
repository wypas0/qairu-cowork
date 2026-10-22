"use client";

import { useRef } from "react";

import { THEME_COOKIE, THEMES, type Theme } from "@/lib/theme";
import { calm, useThumb } from "./motion";

/**
 * Применить тему: атрибут data-theme на <html> меняется сразу, без
 * перезагрузки, а выбор запоминается в куке на год — сервер при следующем
 * рендере поставит тот же атрибут.
 */
export function applyTheme(next: Theme) {
  const root = document.documentElement;
  if (next === "system") delete root.dataset.theme;
  else root.dataset.theme = next;
  document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

/** Переключатель темы: «как в системе», светлая, тёмная. */
export function ThemeSwitch({
  value,
  onChange,
  labels,
}: {
  value: Theme;
  onChange: (next: Theme) => void;
  labels: { title: string } & Record<Theme, string>;
}) {
  const box = useRef<HTMLDivElement>(null);
  useThumb(box, value);
  return (
    <div className="pp-theme" role="radiogroup" aria-label={labels.title} ref={box}>
      {THEMES.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          onClick={() => {
            // Страница перетекает в новую тему, а не перекрашивается рывком.
            const swap = () => applyTheme(option);
            if (!calm() && typeof document.startViewTransition === "function") document.startViewTransition(swap);
            else swap();
            onChange(option);
          }}
        >
          {labels[option]}
        </button>
      ))}
    </div>
  );
}
