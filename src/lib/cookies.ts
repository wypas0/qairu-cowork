/**
 * Константы куки-сессии.
 *
 * Вынесены отдельно от `config.ts` намеренно: их читает middleware, который
 * работает на edge-рантайме, а `config.ts` тянет `node:crypto`.
 */

export const COOKIE_NAME = "qairu_token";
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // год
export const INITDATA_MAX_AGE = 60 * 60 * 24; // сутки
