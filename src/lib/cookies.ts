/**
 * Константы куки-сессии.
 *
 * Вынесены отдельно от `config.ts` намеренно: их читает proxy (`src/proxy.ts`),
 * которому незачем тянуть весь конфиг вместе с `node:crypto`.
 */

export const COOKIE_NAME = "qairu_token";
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // год
export const INITDATA_MAX_AGE = 60 * 60 * 24; // сутки

/**
 * Последние открытые группы — их коды через точку, свежая первой. Нужна,
 * чтобы группы стояли в списках по тому, где человек был недавно, и чтобы
 * мини-апп открывался сразу в последней группе. Не секрет и не вход — это
 * просто порядок, поэтому кука обычная, не HttpOnly.
 */
export const RECENT_COOKIE = "qairu_recent";
export const RECENT_LIMIT = 20;

/** Порядок из куки: список кодов, свежий первым. */
export function parseRecent(value: string | undefined): string[] {
  return (value ?? "")
    .split(".")
    .map((code) => code.trim().toLowerCase())
    .filter((code) => /^[a-z0-9]{3,24}$/.test(code));
}

/**
 * Свёрнутый сайдбар и скрытый блок «Лучшее время» — просто удобство вида,
 * запоминается на устройстве. Кука, а не localStorage: сервер сразу рисует
 * страницу в нужном виде, без вспышки при загрузке.
 */
export const SIDEBAR_COOKIE = "qairu_sidebar";
export const BEST_COOKIE = "qairu_best";
export const VIEW_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Записать куку вида из браузера. */
export function setViewCookie(name: string, value: string | null): void {
  document.cookie =
    value === null
      ? `${name}=; path=/; max-age=0; samesite=lax`
      : `${name}=${value}; path=/; max-age=${VIEW_COOKIE_MAX_AGE}; samesite=lax`;
}
