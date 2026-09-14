/**
 * Пароли и логины для входа на сайт.
 *
 * Хэш — scrypt из стандартной библиотеки Node: он медленный и прожорливый по
 * памяти, поэтому перебор по утёкшей базе дорог, а сторонняя зависимость не
 * нужна. Параметры записываются в саму строку хэша: если их однажды поднять,
 * старые пароли продолжат проверяться.
 */

import "server-only";

import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt) as (
  password: string | Buffer,
  salt: Buffer,
  keylen: number,
  options: crypto.ScryptOptions,
) => Promise<Buffer>;

const N = 16384;
const R = 8;
const P = 1;
const KEY_LEN = 64;
// Потолок, выше которого scrypt не пустит без явного maxmem.
const MAX_MEM = 64 * 1024 * 1024;

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export const LOGIN_RE = /^[a-z0-9][a-z0-9_.-]{2,31}$/;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, KEY_LEN, { N, r: R, p: P, maxmem: MAX_MEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

/** Постоянное время сравнения; битая строка хэша — просто «не совпал». */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, rawN, rawR, rawP, rawSalt, rawKey] = parts;
  const n = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  if (![n, r, p].every((value) => Number.isInteger(value) && value > 0)) return false;

  const salt = Buffer.from(rawSalt, "base64url");
  const expected = Buffer.from(rawKey, "base64url");
  if (salt.length === 0 || expected.length === 0) return false;

  let actual: Buffer;
  try {
    actual = await scrypt(password.normalize("NFKC"), salt, expected.length, { N: n, r, p, maxmem: MAX_MEM });
  } catch {
    return false;
  }
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/** Логин в каноническом виде: без @ и пробелов, в нижнем регистре. */
export function normalizeLogin(value: string): string {
  return value.trim().replace(/^@+/, "").toLowerCase();
}

export type LoginProblem = "login_format" | "password_short" | "password_long" | "password_mismatch";

/** Проверка формы «задать логин и пароль». null — всё в порядке. */
export function validateCredentials(input: {
  login: string;
  password: string;
  confirm: string;
}): LoginProblem | null {
  if (!LOGIN_RE.test(normalizeLogin(input.login))) return "login_format";
  if (input.password.length < PASSWORD_MIN) return "password_short";
  if (input.password.length > PASSWORD_MAX) return "password_long";
  if (input.password !== input.confirm) return "password_mismatch";
  return null;
}
