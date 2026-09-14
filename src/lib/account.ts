/**
 * Проверки вокруг входа по паролю, отделённые от серверных действий.
 *
 * Действия читают куки и делают редиректы — их неудобно тестировать. Всё, от
 * чего зависит безопасность (лимит попыток и подтверждение текущим паролем),
 * живёт здесь и проверяется тестами напрямую.
 */

import "server-only";

import * as repo from "@/db/repo";
import { verifyPassword } from "./password";

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
/** Попыток на один логин за окно: достаточно, чтобы ошибиться, мало для перебора. */
export const MAX_PER_LOGIN = 8;
/** Попыток с одного адреса за окно — против перебора по многим логинам. */
export const MAX_PER_IP = 40;
/** Попыток подтвердить текущий пароль в аккаунте за окно. */
export const MAX_CURRENT_PASSWORD = 8;

/**
 * Засчитать попытку входа ДО проверки пароля.
 *
 * Счётчик увеличивается атомарно и сразу, поэтому пачка одновременных
 * запросов упирается в лимит: каждый видит уже увеличенное значение. Успешный
 * вход потом сбрасывает счётчик логина (resetLoginAttempts).
 */
export async function registerLoginAttempt(login: string, ip: string): Promise<boolean> {
  const perLogin = await repo.bumpCounter(`login:${login}`, LOGIN_WINDOW_MS);
  const perIp = await repo.bumpCounter(`loginip:${ip}`, LOGIN_WINDOW_MS);
  return perLogin <= MAX_PER_LOGIN && perIp <= MAX_PER_IP;
}

export async function resetLoginAttempts(login: string): Promise<void> {
  await repo.deleteBotState(`login:${login}`);
}

export type CurrentPasswordCheck = "ok" | "wrong" | "throttled" | "no_credentials";

/**
 * Подтвердить личность текущим паролем перед изменением способа входа.
 *
 * Нужна и для смены пароля, и для отключения входа по паролю: иначе человек
 * за оставленным открытым браузером отключил бы пароль и тут же задал свой,
 * не зная старого, — и увёл бы аккаунт.
 */
export async function checkCurrentPassword(
  userId: number,
  current: string,
): Promise<CurrentPasswordCheck> {
  const existing = await repo.getCredentials(userId);
  if (!existing) return "no_credentials";

  const key = `acct:${userId}`;
  if ((await repo.bumpCounter(key, LOGIN_WINDOW_MS)) > MAX_CURRENT_PASSWORD) return "throttled";
  if (!(await verifyPassword(current, existing.passwordHash))) return "wrong";

  await repo.deleteBotState(key);
  return "ok";
}
