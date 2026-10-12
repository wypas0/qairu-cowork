/** Конфигурация из переменных окружения. */

import crypto from "node:crypto";

import { DEFAULT_TZ, tzOf } from "@/core/timeutils";

export { COOKIE_MAX_AGE, COOKIE_NAME, INITDATA_MAX_AGE } from "./cookies";

export const SLOT_STEP = 30; // шаг сетки, минуты
export const DAYS_AHEAD = 7;

/**
 * Переменная окружения. Пустая строка и одни пробелы — то же, что не заданная:
 * Vercel охотно хранит пустые значения (так `DEFAULT_TZ=""` уронил консоль),
 * а `process.env.X ?? запасное` пропускает пустую строку мимо запасного.
 * Значение возвращается без пробелов по краям. Все чтения env в `src/` идут
 * через эту функцию (правило ESLint в `eslint.config.mjs`); исключение —
 * `NODE_ENV` и `NEXT_RUNTIME`, которые Next подставляет при сборке.
 */
export function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function botToken(): string {
  return env("BOT_TOKEN") ?? "";
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
  const explicit = env("TELEGRAM_WEBHOOK_SECRET");
  if (explicit) return explicit;
  const token = botToken();
  if (!token) return "";
  return crypto.createHash("sha256").update(`qairu-webhook:${token}`).digest("hex").slice(0, 48);
}

/** Публичный адрес сайта. На Vercel определяется сам, локально — из .env. */
export function siteUrl(): string {
  const explicit = env("NEXT_PUBLIC_SITE_URL") ?? env("WEB_BASE_URL");
  if (explicit) return explicit.replace(/\/+$/, "");
  const production = env("VERCEL_PROJECT_PRODUCTION_URL");
  if (production) return `https://${production}`;
  const preview = env("VERCEL_URL");
  if (preview) return `https://${preview}`;
  return "";
}

/**
 * Пояс консоли владельца (`/admin`): в нём показывается время входов,
 * прогонов cron и прочих событий. Остальной сайт и бот живут в поясе группы (`chats.tz`), эта
 * переменная их не трогает. Пустая переменная и опечатка в имени дают
 * Asia/Almaty — проверку делает тот же `tzOf`, что и для поясов групп.
 */
export function defaultTz(): string {
  return tzOf(env("DEFAULT_TZ"), DEFAULT_TZ);
}

/** Секрет для ручного вызова cron-эндпоинта. Vercel подставляет его сам. */
export function cronSecret(): string {
  return env("CRON_SECRET") ?? "";
}

/** Куда бот шлёт алерты об ошибках сервера: id человека или чата. Пусто — никуда. */
export function alertChatId(): string {
  return env("ALERT_CHAT_ID") ?? "";
}

/**
 * Ключ HMAC консоли владельца: им хешируются одноразовые коды и адреса в
 * журнале входов. В базе его нет — утёкшая таблица не даёт ни перебрать
 * 6-значный код, ни восстановить IP перебором всех адресов. Можно не задавать:
 * тогда выводится из BOT_TOKEN (без бота консоль всё равно недоступна — код
 * некому прислать). Пусто — консоль выключена.
 */
export function ownerConsoleSecret(): string {
  const explicit = env("OWNER_CONSOLE_SECRET");
  if (explicit) return explicit;
  const token = botToken();
  if (!token) return "";
  return crypto.createHash("sha256").update(`qairu-owner-console:${token}`).digest("hex");
}

/**
 * Адрес «пульса» cron в healthchecks.io (или похожем сервисе): после каждого
 * удачного прогона напоминаний туда уходит GET, после неудачного — GET на
 * `<адрес>/fail`. Не пришёл пульс вовремя — сервис пишет в Telegram.
 * Только https: адрес — сам себе пароль, по http он ушёл бы открытым текстом.
 * Пусто или не https — пульса нет.
 */
export function healthchecksPingUrl(): string {
  const raw = env("HEALTHCHECKS_PING_URL");
  if (!raw) return "";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "";
  }
  if (url.protocol !== "https:" || url.username || url.password) return "";
  return raw.replace(/\/+$/, "");
}
