/** Конфигурация из переменных окружения. */

import crypto from "node:crypto";

export { COOKIE_MAX_AGE, COOKIE_NAME, INITDATA_MAX_AGE } from "./cookies";

export const SLOT_STEP = 30; // шаг сетки, минуты
export const DAYS_AHEAD = 7;

export function botToken(): string {
  return (process.env.BOT_TOKEN ?? "").trim();
}

export function hasBot(): boolean {
  return botToken().length > 0;
}

/**
 * Секрет для заголовка `X-Telegram-Bot-Api-Secret-Token`.
 *
 * Если админ не задал его явно — выводим детерминированно из токена бота.
 * Тогда для запуска достаточно одного BOT_TOKEN: вебхук регистрируется и
 * проверяется без дополнительной настройки, а угадать секрет, не зная токена,
 * невозможно.
 */
export function webhookSecret(): string {
  const explicit = (process.env.TELEGRAM_WEBHOOK_SECRET ?? "").trim();
  if (explicit) return explicit;
  const token = botToken();
  if (!token) return "";
  return crypto.createHash("sha256").update(`qairu-webhook:${token}`).digest("hex").slice(0, 48);
}

/** Публичный адрес сайта. На Vercel определяется сам, локально — из .env. */
export function siteUrl(): string {
  const explicit = (process.env.NEXT_PUBLIC_SITE_URL ?? process.env.WEB_BASE_URL ?? "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (production) return `https://${production}`;
  const preview = process.env.VERCEL_URL;
  if (preview) return `https://${preview}`;
  return "";
}

const FALLBACK_TZ = "Asia/Almaty";

/**
 * Пояс сайта. Пустая переменная в Vercel — то же, что незаданная: `??` её
 * пропускал, и Intl падал на «Invalid time zone specified: ». Опечатку в
 * имени пояса тоже не пускаем дальше — её не переварят ни Intl, ни Postgres.
 */
export function defaultTz(): string {
  const tz = (process.env.DEFAULT_TZ ?? "").trim();
  if (!tz) return FALLBACK_TZ;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz;
  } catch {
    return FALLBACK_TZ;
  }
}

export function defaultLang(): string {
  return (process.env.DEFAULT_LANG ?? "").trim() || "ru";
}

/** Секрет для ручного вызова cron-эндпоинта. Vercel подставляет его сам. */
export function cronSecret(): string {
  return (process.env.CRON_SECRET ?? "").trim();
}

/** Куда бот шлёт алерты об ошибках сервера: id человека или чата. Пусто — никуда. */
export function alertChatId(): string {
  return (process.env.ALERT_CHAT_ID ?? "").trim();
}

/**
 * Ключ HMAC консоли владельца: им хешируются одноразовые коды и адреса в
 * журнале входов. В базе его нет — утёкшая таблица не даёт ни перебрать
 * 6-значный код, ни восстановить IP перебором всех адресов. Можно не задавать:
 * тогда выводится из BOT_TOKEN (без бота консоль всё равно недоступна — код
 * некому прислать). Пусто — консоль выключена.
 */
export function ownerConsoleSecret(): string {
  const explicit = (process.env.OWNER_CONSOLE_SECRET ?? "").trim();
  if (explicit) return explicit;
  const token = botToken();
  if (!token) return "";
  return crypto.createHash("sha256").update(`qairu-owner-console:${token}`).digest("hex");
}
