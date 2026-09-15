/**
 * Вход и регистрация на сайте через Telegram-бота.
 *
 * 1. Сайт создаёт одноразовый запрос: публичный код уходит в ссылку на бота
 *    (`t.me/<bot>?start=login_<код>`), секрет — в HttpOnly-куку этого браузера.
 * 2. Человек открывает ссылку. Бот привязывает запрос к его Telegram-аккаунту
 *    и спрашивает «Войти как …?». Подтвердить может только тот, кто открыл.
 * 3. Вкладка сайта опрашивает статус. Получив подтверждение и предъявив
 *    секрет из куки, она забирает запрос (одноразово) и получает сессию.
 *
 * Код без секрета бесполезен: чужой, увидевший ссылку, не войдёт на сайт, даже
 * если сам нажмёт «Подтвердить» — он лишь впустит владельца куки в СВОЙ аккаунт.
 * Обратный сценарий (злоумышленник присылает жертве свою ссылку) закрывается
 * текстом в боте: он показывает браузер и устройство, откуда пришёл запрос, и
 * прямо предупреждает не подтверждать чужие входы. Запрос живёт 5 минут.
 */

import "server-only";

import crypto from "node:crypto";

import * as repo from "@/db/repo";
import type { User } from "@/db/schema";

export const LOGIN_REQUEST_TTL_MS = 5 * 60 * 1000;
export const LOGIN_COOKIE = "qairu_tglogin";
export const LOGIN_LINK_PREFIX = "login_";
/** Код в deep link: Telegram разрешает в start-параметре только [A-Za-z0-9_-] и до 64 символов. */
export const LOGIN_CODE_RE = /^[A-Za-z0-9_-]{16,40}$/;

export type LoginStatus = "pending" | "opened" | "confirmed" | "rejected";

/** login — войти или зарегистрироваться; link — подключить Telegram к аккаунту на сайте. */
export type LoginPurpose = "login" | "link";

export type LoginRequest = {
  status: LoginStatus;
  secretHash: string;
  createdAt: number;
  next: string;
  /** Сайтовый аккаунт, который был в браузере при старте, — его перенесём в Telegram. */
  mergeFrom: number | null;
  device: string;
  telegramUserId: number | null;
  /** У запросов, созданных до появления поля, его нет — это вход. */
  purpose?: LoginPurpose;
};

function key(code: string): string {
  return `tglogin:${code}`;
}

function hash(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

function expired(request: LoginRequest, now = Date.now()): boolean {
  return now - request.createdAt > LOGIN_REQUEST_TTL_MS;
}

/** «Chrome · Windows» из User-Agent — чтобы в боте было видно, откуда запрос. */
export function describeDevice(userAgent: string): string {
  const ua = userAgent || "";
  const browser = /YaBrowser/i.test(ua)
    ? "Яндекс Браузер"
    : /Edg\//.test(ua)
      ? "Edge"
      : /OPR\/|Opera/.test(ua)
        ? "Opera"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Chrome\//.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : "";
  const os = /Android/i.test(ua)
    ? "Android"
    : /iPhone|iPad|iPod/i.test(ua)
      ? "iOS"
      : /Windows/i.test(ua)
        ? "Windows"
        : /Mac OS X|Macintosh/i.test(ua)
          ? "macOS"
          : /Linux/i.test(ua)
            ? "Linux"
            : "";
  return [browser, os].filter(Boolean).join(" · ") || "неизвестное устройство";
}

/** Создать запрос. Возвращает публичный код и секрет для куки. */
export async function createLoginRequest(args: {
  next: string;
  mergeFrom: User | null;
  userAgent: string;
  purpose?: LoginPurpose;
}): Promise<{ code: string; secret: string }> {
  // Заодно убираем брошенные запросы: их никто уже не заберёт.
  await repo.deleteStaleBotState("tglogin:", new Date(Date.now() - 24 * 60 * 60 * 1000));

  const code = crypto.randomBytes(18).toString("base64url");
  const secret = crypto.randomBytes(32).toString("base64url");
  const request: LoginRequest = {
    status: "pending",
    secretHash: hash(secret),
    createdAt: Date.now(),
    next: args.next,
    mergeFrom: args.mergeFrom?.isWeb ? args.mergeFrom.userId : null,
    device: describeDevice(args.userAgent),
    telegramUserId: null,
    // Подключать есть что, только если в браузере аккаунт с сайта; иначе это обычный вход.
    purpose: args.purpose === "link" && args.mergeFrom?.isWeb ? "link" : "login",
  };
  await repo.setBotState(key(code), request);
  return { code, secret };
}

/** Цель запроса по коду из куки — страница ожидания подбирает под неё текст. */
export async function loginRequestPurpose(code: string): Promise<LoginPurpose | null> {
  if (!LOGIN_CODE_RE.test(code)) return null;
  const request = await repo.getBotState<LoginRequest>(key(code));
  return request ? (request.purpose ?? "login") : null;
}

export type OpenResult =
  | { ok: true; request: LoginRequest }
  | { ok: false; reason: "missing" | "expired" | "used" | "not_yours" };

/** Человек открыл ссылку в боте: запрос закрепляется за его Telegram-аккаунтом. */
export async function openLoginRequest(code: string, telegramUserId: number): Promise<OpenResult> {
  if (!LOGIN_CODE_RE.test(code)) return { ok: false, reason: "missing" };
  const request = await repo.getBotState<LoginRequest>(key(code));
  if (!request) return { ok: false, reason: "missing" };
  if (expired(request)) return { ok: false, reason: "expired" };
  if (request.status === "confirmed" || request.status === "rejected") return { ok: false, reason: "used" };
  if (request.telegramUserId !== null && request.telegramUserId !== telegramUserId) {
    return { ok: false, reason: "not_yours" };
  }
  const opened: LoginRequest = { ...request, status: "opened", telegramUserId };
  await repo.setBotState(key(code), opened);
  return { ok: true, request: opened };
}

export type DecideResult = "confirmed" | "rejected" | "missing" | "expired" | "used" | "not_yours";

/** Кнопка «Подтвердить» или «Это не я» в боте. */
export async function decideLoginRequest(
  code: string,
  telegramUserId: number,
  approve: boolean,
): Promise<DecideResult> {
  if (!LOGIN_CODE_RE.test(code)) return "missing";
  const request = await repo.getBotState<LoginRequest>(key(code));
  if (!request) return "missing";
  if (expired(request)) return "expired";
  if (request.status === "confirmed" || request.status === "rejected") return "used";
  if (request.telegramUserId !== telegramUserId) return "not_yours";

  const status: LoginStatus = approve ? "confirmed" : "rejected";
  await repo.setBotState(key(code), { ...request, status });
  return status;
}

export type CompleteResult =
  | { status: "pending" }
  | { status: "rejected" | "expired" | "invalid" }
  | { status: "ok"; userId: number; next: string; merged: boolean };

/**
 * Опрос со страницы сайта. `cookieValue` — содержимое куки `код.секрет`.
 *
 * Сессию выдаёт вызывающий (route handler) по `userId`. Перенос сайтового
 * аккаунта выполняется, только если в браузере до сих пор вошёл тот же
 * сайтовый аккаунт, что был при старте запроса.
 */
export async function completeLoginRequest(
  cookieValue: string,
  current: User | null,
): Promise<CompleteResult> {
  const [code, secret] = cookieValue.split(".");
  if (!code || !secret || !LOGIN_CODE_RE.test(code)) return { status: "invalid" };

  const request = await repo.getBotState<LoginRequest>(key(code));
  if (!request) return { status: "invalid" };
  const expected = Buffer.from(request.secretHash, "hex");
  const actual = Buffer.from(hash(secret), "hex");
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    return { status: "invalid" };
  }
  if (request.status === "rejected") {
    await repo.deleteBotState(key(code));
    return { status: "rejected" };
  }
  if (expired(request)) {
    await repo.deleteBotState(key(code));
    return { status: "expired" };
  }
  if (request.status !== "confirmed" || request.telegramUserId === null) return { status: "pending" };

  // Одноразово: из параллельных опросов запрос заберёт только один.
  const taken = await repo.takeBotState<LoginRequest>(key(code));
  if (!taken || taken.status !== "confirmed" || taken.telegramUserId === null) return { status: "invalid" };

  let merged = false;
  if (taken.mergeFrom !== null && current?.userId === taken.mergeFrom && current.isWeb) {
    merged = await repo.mergeWebUserIntoTelegram(taken.mergeFrom, taken.telegramUserId);
  }
  return { status: "ok", userId: taken.telegramUserId, next: taken.next, merged };
}
