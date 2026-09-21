import "server-only";

import crypto from "node:crypto";

import { webhookSecret } from "./config";

/**
 * Личная ссылка на календарь встреч.
 *
 * Календарь (Google, Apple, Outlook) забирает ленту со своих серверов, без
 * наших кук, поэтому доступ даёт сама ссылка: в ней id человека и подпись.
 * Подпись считается от секрета вебхука — отдельного секрета заводить не нужно,
 * а подделать ссылку чужого человека без него нельзя. Отозвать все ссылки
 * разом можно, сменив TELEGRAM_WEBHOOK_SECRET.
 */

function sign(userId: number): string {
  return crypto
    .createHmac("sha256", webhookSecret() || "qairu-local")
    .update(`calendar:${userId}`)
    .digest("base64url")
    .slice(0, 24);
}

/** Токен ленты: «<id>_<подпись>». */
export function feedToken(userId: number): string {
  return `${userId}_${sign(userId)}`;
}

/** id человека из токена или null, если подпись не сходится. */
export function verifyFeedToken(token: string): number | null {
  const match = /^(-?\d{1,20})_([A-Za-z0-9_-]{24})$/.exec(token);
  if (!match) return null;
  const userId = Number(match[1]);
  if (!Number.isSafeInteger(userId)) return null;
  const expected = Buffer.from(sign(userId));
  const given = Buffer.from(match[2]);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given) ? userId : null;
}

/** Адрес ленты; с `slug` — только встречи этой группы. */
export function feedPath(userId: number, slug?: string): string {
  const path = `/api/calendar/${feedToken(userId)}.ics`;
  return slug ? `${path}?g=${encodeURIComponent(slug)}` : path;
}
