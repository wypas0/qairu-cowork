/**
 * Тема сайта. Хранится в обычной (не HttpOnly) куке: сервер ставит атрибут
 * data-theme на <html> ещё при рендере — без вспышки чужой темы, — а
 * переключатель в панели профиля меняет её мгновенно, без запроса.
 */

export const THEME_COOKIE = "qairu_theme";
export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export function normalizeTheme(value: string | null | undefined): Theme {
  return value === "light" || value === "dark" ? value : "system";
}
