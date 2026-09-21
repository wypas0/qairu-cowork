/**
 * Константы куки-сессии.
 *
 * Вынесены отдельно от `config.ts` намеренно: их читает middleware, который
 * работает на edge-рантайме, а `config.ts` тянет `node:crypto`.
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
