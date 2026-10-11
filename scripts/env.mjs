/**
 * Переменная окружения для скриптов сборки — то же правило, что `env()` в
 * `src/lib/config.ts`: пустая строка и одни пробелы — то же, что не заданная.
 * Иначе `NEXT_PUBLIC_SITE_URL=""` в Vercel пропускал `WEB_BASE_URL` и вебхук
 * уезжал на `VERCEL_PROJECT_PRODUCTION_URL`.
 *
 * @param {string} name
 * @returns {string | undefined}
 */
export function env(name) {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}
