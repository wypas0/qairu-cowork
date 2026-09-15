"use client";

import { THEME_COOKIE, THEMES, type Theme } from "@/lib/theme";

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
  return (
    <div className="pp-theme" role="radiogroup" aria-label={labels.title}>
      {THEMES.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          onClick={() => {
            applyTheme(option);
            onChange(option);
          }}
        >
          {labels[option]}
        </button>
      ))}
    </div>
  );
}
