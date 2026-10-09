/**
 * Кто смотрит консоль владельца: куки и заголовки запроса. Логика входа — в
 * lib/ownerConsole, здесь только то, что читает запрос и пишет куку.
 */

import "server-only";

import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";

import type { User } from "@/db/schema";
import { currentTelegramUser, currentToken } from "./auth";
import { isOwner } from "./owner";
import { type ClientInfo, OWNER_SESSION_TTL_MS, ownerConsoleSession } from "./ownerConsole";

export const OWNER_COOKIE = "qairu_owner";
/** Кука уходит только на адреса консоли: остальному сайту она не нужна и не видна. */
export const OWNER_COOKIE_PATH = "/admin";

/**
 * SameSite=Strict: браузер не приложит куку ни к одному запросу, начатому
 * чужой страницей, — в отличие от сессии сайта (SameSite=None ради Mini App).
 * Цена: по ссылке из другого сайта или мессенджера консоль откроется формой
 * кода — достаточно обновить страницу.
 */
function cookieOptions(maxAgeSec: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: OWNER_COOKIE_PATH,
    maxAge: maxAgeSec,
  };
}

/** Адрес и браузер посетителя — для журнала (там они только ключевым хешем). */
export async function clientInfo(): Promise<ClientInfo> {
  const requestHeaders = await headers();
  const forwarded = requestHeaders.get("x-forwarded-for") ?? "";
  return {
    ip: forwarded.split(",")[0].trim() || requestHeaders.get("x-real-ip") || "unknown",
    userAgent: (requestHeaders.get("user-agent") ?? "").slice(0, 512),
  };
}

/** Вошедший через Telegram владелец или null — тогда «не найдено». */
export async function ownerViewer(): Promise<{ user: User; webToken: string } | null> {
  const user = await currentTelegramUser();
  if (!user || !isOwner(user.userId)) return null;
  const webToken = await currentToken();
  return webToken ? { user, webToken } : null;
}

export async function ownerConsoleToken(): Promise<string> {
  const store = await cookies();
  return store.get(OWNER_COOKIE)?.value ?? "";
}

/** Действующая сессия консоли этого владельца. */
export async function currentOwnerSession(viewer: { user: User; webToken: string }) {
  return ownerConsoleSession(viewer.user.userId, viewer.webToken, await ownerConsoleToken());
}

export type OwnerAccess = {
  user: User;
  webToken: string;
  /** null — владелец, но консоль не открыта: страница показывает только ввод кода и ничего не читает. */
  session: { createdAt: Date; expiresAt: Date } | null;
};

/**
 * Общий гейт каждой страницы консоли (/admin, /admin/users, /admin/users/[id]…).
 * Не владелец, не вошёл или вошёл аккаунтом сайта — «не найдено», как будто
 * адреса нет. Вызывать первым делом, до любого чтения данных: страницы
 * собирает ownerPage (components/owner/OwnerPage), а не каждая сама.
 */
export async function ownerAccess(): Promise<OwnerAccess> {
  const viewer = await ownerViewer();
  if (!viewer) notFound();
  return { ...viewer, session: await currentOwnerSession(viewer) };
}

/**
 * noindex и no-referrer — только владельцу. Статичный `metadata` попадал бы
 * и в ответ «не найдено» для остальных, и тот отличался бы от обычного 404.
 */
export async function ownerMetadata(): Promise<Metadata> {
  if (!(await ownerViewer())) return {};
  return { robots: { index: false, follow: false, nocache: true }, referrer: "no-referrer" };
}

export async function setOwnerCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(OWNER_COOKIE, token, cookieOptions(Math.floor(OWNER_SESSION_TTL_MS / 1000)));
}

export async function clearOwnerCookie(): Promise<void> {
  const store = await cookies();
  // Удалять надо с тем же путём, иначе браузер оставит куку /admin.
  store.set(OWNER_COOKIE, "", cookieOptions(0));
}
