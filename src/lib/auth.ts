/**
 * Аутентификация сайта: токен-ссылка и вход из Telegram Mini App.
 *
 * Аккаунтов и паролей нет. Личность подтверждается одним из двух способов:
 *
 * 1. Токен в куке `qairu_token` — выдаётся при создании группы, при входе по
 *    ссылке-приглашению и командой /link в боте.
 * 2. `initData` из Telegram Mini App — подписанные Telegram данные, из которых
 *    достоверно берётся telegram user_id. Тогда веб и бот — один и тот же человек.
 */

import "server-only";

import crypto from "node:crypto";
import { cookies } from "next/headers";

import * as repo from "@/db/repo";
import type { User } from "@/db/schema";
import { COOKIE_MAX_AGE, COOKIE_NAME, INITDATA_MAX_AGE } from "./cookies";

export class InitDataError extends Error {}

export type TelegramInitUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
};

/**
 * Проверить подпись Telegram Mini App и вернуть разобранные поля.
 *
 * Алгоритм из документации Telegram:
 *   secret_key    = HMAC_SHA256(key="WebAppData", msg=bot_token)
 *   data_check    = "\n".join(sorted("key=value" для всех полей, кроме hash))
 *   expected_hash = hex(HMAC_SHA256(key=secret_key, msg=data_check))
 *
 * Сравнение — постоянного времени; отдельно проверяется свежесть auth_date,
 * иначе перехваченный initData работал бы вечно.
 */
export function verifyInitData(
  initData: string,
  token: string,
  maxAge: number = INITDATA_MAX_AGE,
): Record<string, string> & { user?: TelegramInitUser } {
  if (!token) {
    throw new InitDataError("BOT_TOKEN не задан — проверить подпись невозможно");
  }

  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash") ?? "";
  if (!receivedHash) throw new InitDataError("в initData нет hash");
  params.delete("hash");

  const pairs: [string, string][] = [];
  params.forEach((value, key) => pairs.push([key, value]));
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const dataCheckString = pairs.map(([key, value]) => `${key}=${value}`).join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  const expected = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  const expectedBuf = Buffer.from(expected, "utf8");
  const receivedBuf = Buffer.from(receivedHash, "utf8");
  if (
    expectedBuf.length !== receivedBuf.length ||
    !crypto.timingSafeEqual(expectedBuf, receivedBuf)
  ) {
    throw new InitDataError("подпись initData не совпала");
  }

  const authDate = Number(params.get("auth_date") ?? "0") || 0;
  if (maxAge && Date.now() / 1000 - authDate > maxAge) {
    throw new InitDataError("initData просрочен");
  }

  const result: Record<string, string> & { user?: TelegramInitUser } = Object.fromEntries(pairs);
  const rawUser = params.get("user");
  if (rawUser) {
    try {
      result.user = JSON.parse(rawUser) as TelegramInitUser;
    } catch {
      throw new InitDataError("не удалось разобрать поле user");
    }
  }
  return result;
}

/** Текущий посетитель по куке. `null` — не представился. */
export async function currentUser(): Promise<User | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value ?? "";
  if (!token) return null;
  return repo.userByWebToken(token);
}

export function tokenCookieOptions(): {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  };
}

/** Положить токен в куку. Работает в Server Action и в Route Handler. */
export async function setTokenCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, token, tokenCookieOptions());
}
