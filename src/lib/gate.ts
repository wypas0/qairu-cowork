/**
 * Сайт только для Telegram-аккаунтов.
 *
 * Регистрация возможна лишь через Telegram (бот или Mini App). Аккаунты,
 * заведённые раньше на сайте по одному имени, остаются в базе со всеми
 * группами и расписанием, но пользоваться сайтом не могут, пока не подключат
 * Telegram: подключение переносит их данные в Telegram-аккаунт.
 */

import "server-only";

import { redirect } from "next/navigation";

import type { User } from "@/db/schema";
import { currentUser, safeNext } from "./auth";

export function connectUrl(next: string): string {
  return `/connect?next=${encodeURIComponent(safeNext(next))}`;
}

export function loginUrl(next: string): string {
  return `/login?next=${encodeURIComponent(safeNext(next))}`;
}

/** Посетитель страницы. Аккаунт без Telegram сразу уводим на экран подключения. */
export async function pageUser(next: string): Promise<User | null> {
  const user = await currentUser();
  if (user?.isWeb) redirect(connectUrl(next));
  return user;
}

/** Для действий, где нужен вошедший Telegram-пользователь: иначе — вход или подключение. */
export async function requireTelegramUser(next: string): Promise<User> {
  const user = await pageUser(next);
  if (!user) redirect(loginUrl(next));
  return user;
}
