/**
 * Консоль владельца (/admin): второй фактор поверх входа через Telegram.
 *
 * Первый фактор — обычная сессия сайта, причём только Telegram-аккаунта из
 * списка владельцев (lib/owner). Остальным страница отвечает «не найдено».
 * Второй — одноразовый код, который бот присылает владельцу в личку:
 *
 * 1. «Прислать код»: 6 цифр из crypto.randomInt, живут 5 минут. В базе только
 *    HMAC-SHA256 кода с солью и ключом, которого в базе нет (ownerConsoleSecret):
 *    по утёкшей таблице миллион вариантов не перебрать. Не больше 3 кодов за 15 минут.
 * 2. Ввод: попытка засчитывается атомарно до сравнения, сравнение — за
 *    постоянное время. 5 неверных — код сгорает; 10 неверных за час — вход
 *    закрыт на час, сколько бы новых кодов ни просили.
 * 3. Верный код — отдельная сессия консоли: 32 случайных байта в куке
 *    (HttpOnly, Secure, SameSite=Strict, путь /admin, 12 часов), в базе — SHA-256.
 *    Сессия привязана к человеку и к его сессии сайта: выйти с сайта — выйти и из консоли.
 *
 * Каждый шаг пишется в журнал (адрес и браузер — ключевым хешем), а вход и
 * серия неверных кодов приходят алертом от бота.
 *
 * Здесь нет кук и заголовков — только логика, её проверяют тесты напрямую.
 * Куки — в lib/ownerGate, действия — в app/admin/actions.
 */

import "server-only";

import crypto from "node:crypto";

import { sendMessage } from "@/bot/api";
import { escapeHtml } from "@/core/textutils";
import * as repo from "@/db/repo";
import type { User } from "@/db/schema";
import { t } from "@/i18n";
import { reportOwnerConsole } from "./alerts";
import { hasBot, ownerConsoleSecret } from "./config";
import { isOwner } from "./owner";
import { describeDevice } from "./tglogin";

export const OWNER_CODE_TTL_MS = 5 * 60 * 1000;
/** Неверных вводов одного кода, после которых он сгорает. */
export const OWNER_CODE_MAX_ATTEMPTS = 5;
/** Кодов за окно: хватит, если первый не дошёл, мало для перебора. */
export const OWNER_CODE_REQUESTS = 3;
export const OWNER_CODE_WINDOW_MS = 15 * 60 * 1000;
/** Неверных кодов за час на человека, после которых вход закрыт до конца часа. */
export const OWNER_FAILS_PER_HOUR = 10;
export const OWNER_FAILS_WINDOW_MS = 60 * 60 * 1000;
/** На каком по счёту неверном коде за час присылать алерт. */
export const OWNER_FAILS_ALERT = 3;
export const OWNER_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
/** Токен сессии консоли в куке: 32 байта в base64url. */
export const OWNER_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export type ClientInfo = { ip: string; userAgent: string };
type Owner = Pick<User, "userId" | "lang">;

/** HMAC-SHA256 с ключом консоли. purpose разводит коды, адреса и браузеры: одно не подставить вместо другого. */
export function ownerHmac(purpose: string, value: string, secret = ownerConsoleSecret()): string {
  return crypto.createHmac("sha256", secret).update(`${purpose}\n${value}`).digest("hex");
}

export function hashOwnerCode(userId: number, code: string, salt: string, secret?: string): string {
  return ownerHmac("code", `${userId}:${salt}:${code}`, secret);
}

export function newOwnerCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

/** «123 456», «123-456» → «123456»; что-то другое — null (попыткой не считается). */
export function normalizeOwnerCode(input: string): string | null {
  const digits = input.replace(/[\s-]/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}

/** Сравнение хешей за постоянное время. */
export function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

/** Что пишется в журнал об устройстве: ключевые хеши и грубая метка «Chrome · Windows». */
export function fingerprint(client: ClientInfo): { ipHash: string; uaHash: string; device: string } {
  return {
    ipHash: ownerHmac("ip", client.ip),
    uaHash: ownerHmac("ua", client.userAgent),
    device: describeDevice(client.userAgent),
  };
}

async function log(userId: number, event: repo.OwnerEvent, ok: boolean, client: ClientInfo): Promise<void> {
  await repo.logOwnerEvent({ userId, event, ok, ...fingerprint(client) });
}

/** Метка адреса для алерта и журнала: первые 8 знаков ключевого хеша. Сам адрес не раскрывается. */
export function ipTag(ipHash: string): string {
  return ipHash.slice(0, 8);
}

export type RequestCodeResult = "sent" | "throttled" | "no_bot" | "send_failed" | "not_owner";

/** «Прислать код»: новый код заменяет прежний, бот присылает его владельцу в личку. */
export async function requestOwnerCode(
  owner: Owner,
  client: ClientInfo,
  now = new Date(),
): Promise<RequestCodeResult> {
  if (!isOwner(owner.userId)) return "not_owner";
  if (!hasBot() || !ownerConsoleSecret()) return "no_bot";

  if ((await repo.bumpCounter(`ownercode:${owner.userId}`, OWNER_CODE_WINDOW_MS)) > OWNER_CODE_REQUESTS) {
    await log(owner.userId, "throttled", false, client);
    return "throttled";
  }

  const code = newOwnerCode();
  const salt = crypto.randomBytes(16).toString("hex");
  await repo.storeOwnerCode({
    userId: owner.userId,
    codeHash: hashOwnerCode(owner.userId, code, salt),
    salt,
    expiresAt: new Date(now.getTime() + OWNER_CODE_TTL_MS),
  });

  try {
    await sendMessage({
      chat_id: owner.userId,
      text: t(owner.lang, "owner_code_dm", {
        code,
        minutes: OWNER_CODE_TTL_MS / 60_000,
        device: escapeHtml(describeDevice(client.userAgent)),
      }),
      parse_mode: "HTML",
    });
  } catch {
    // Человек не запускал бота или заблокировал его: код без доставки не нужен.
    await repo.deleteOwnerCode(owner.userId);
    await log(owner.userId, "send_failed", false, client);
    return "send_failed";
  }

  await log(owner.userId, "code_sent", true, client);
  return "sent";
}

export type VerifyCodeResult =
  | { status: "ok"; token: string; expiresAt: Date }
  | { status: "wrong"; left: number }
  | { status: "format" | "missing" | "expired" | "locked" | "throttled" | "not_owner" };

/**
 * Ввод кода. `webToken` — токен сессии сайта из куки: к нему привязывается
 * сессия консоли. Возвращает токен для куки консоли.
 */
export async function verifyOwnerCode(
  owner: Owner,
  input: string,
  webToken: string,
  client: ClientInfo,
  now = new Date(),
): Promise<VerifyCodeResult> {
  if (!isOwner(owner.userId) || !webToken) return { status: "not_owner" };
  // Без ключа HMAC сравнивать не с чем: такие коды и не выдаются (requestOwnerCode).
  if (!ownerConsoleSecret()) return { status: "missing" };
  const code = normalizeOwnerCode(input);
  if (!code) return { status: "format" };

  const failKey = `ownerfail:${owner.userId}`;
  if ((await repo.peekCounter(failKey, OWNER_FAILS_WINDOW_MS)) >= OWNER_FAILS_PER_HOUR) {
    await repo.deleteOwnerCode(owner.userId);
    await log(owner.userId, "throttled", false, client);
    return { status: "throttled" };
  }

  const row = await repo.bumpOwnerCodeAttempt(owner.userId);
  if (!row) return { status: "missing" };
  if (row.expiresAt.getTime() <= now.getTime()) {
    await repo.deleteOwnerCode(owner.userId);
    await log(owner.userId, "expired", false, client);
    return { status: "expired" };
  }
  if (row.attempts > OWNER_CODE_MAX_ATTEMPTS) {
    await repo.deleteOwnerCode(owner.userId);
    return { status: "locked" };
  }

  if (!sameHash(hashOwnerCode(owner.userId, code, row.salt), row.codeHash)) {
    const fails = await repo.bumpCounter(failKey, OWNER_FAILS_WINDOW_MS);
    const left = OWNER_CODE_MAX_ATTEMPTS - row.attempts;
    const print = fingerprint(client);
    if (left <= 0) {
      await repo.deleteOwnerCode(owner.userId);
      await log(owner.userId, "locked", false, client);
      await reportOwnerConsole(owner.userId, [
        "🚫 <b>Консоль: код сгорел</b>",
        `${OWNER_CODE_MAX_ATTEMPTS} неверных вводов подряд · ${escapeHtml(print.device)} · адрес #${ipTag(print.ipHash)}`,
        "Если это не ты — войди в /admin и нажми «Завершить все сессии»: чужие входы закроются и на сайте.",
      ]);
      return { status: "locked" };
    }
    await log(owner.userId, "wrong", false, client);
    if (fails === OWNER_FAILS_ALERT) {
      await reportOwnerConsole(owner.userId, [
        "⚠️ <b>Консоль: неверные коды</b>",
        `${fails} за час · ${escapeHtml(print.device)} · адрес #${ipTag(print.ipHash)}`,
      ]);
    }
    return { status: "wrong", left };
  }

  // Одноразово: из двух одновременных верных вводов сессию получит один.
  if (!(await repo.takeOwnerCode(owner.userId, row.codeHash))) return { status: "missing" };

  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + OWNER_SESSION_TTL_MS);
  await repo.insertOwnerSession({
    tokenHash: repo.hashToken(token),
    userId: owner.userId,
    webTokenHash: repo.hashToken(webToken),
    expiresAt,
  });
  await repo.deleteBotState(failKey);
  await log(owner.userId, "login", true, client);
  await repo.pruneOwnerTables(now);

  const print = fingerprint(client);
  await reportOwnerConsole(owner.userId, [
    "🔐 <b>Вход в консоль владельца</b>",
    `${escapeHtml(print.device)} · адрес #${ipTag(print.ipHash)}`,
    "Если это не ты — войди в /admin и нажми «Завершить все сессии»: чужие входы закроются и на сайте.",
  ]);
  return { status: "ok", token, expiresAt };
}

/**
 * Действующая сессия консоли или null. Владелец проверяется заново на
 * каждом запросе: убрал id из OWNER_IDS — доступ пропал сразу.
 */
export async function ownerConsoleSession(
  userId: number,
  webToken: string,
  consoleToken: string,
  now = new Date(),
): Promise<{ createdAt: Date; expiresAt: Date } | null> {
  if (!isOwner(userId) || !webToken || !OWNER_TOKEN_RE.test(consoleToken)) return null;
  const row = await repo.ownerSessionByHash(repo.hashToken(consoleToken), now);
  if (!row || row.userId !== userId) return null;
  if (!sameHash(row.webTokenHash, repo.hashToken(webToken))) return null;
  return { createdAt: row.createdAt, expiresAt: row.expiresAt };
}

/** «Выйти из консоли»: сессия удаляется на сервере, а не только кука. */
export async function endOwnerSession(userId: number, consoleToken: string, client: ClientInfo): Promise<void> {
  if (OWNER_TOKEN_RE.test(consoleToken)) await repo.deleteOwnerSession(repo.hashToken(consoleToken));
  await log(userId, "logout", true, client);
}

/**
 * «Завершить все сессии»: все сессии консоли этого владельца, его живой код и
 * сессии сайта на других устройствах (кроме текущей `webToken`). Если код
 * пришёл без запроса, кто-то сидит на сайте под владельцем — его надо выкинуть
 * и с сайта, иначе он просто запросит код снова.
 */
export async function endAllOwnerSessions(userId: number, webToken: string, client: ClientInfo): Promise<number> {
  const ended = await repo.deleteOwnerSessionsOf(userId);
  await repo.deleteOwnerCode(userId);
  if (webToken) await repo.deleteOtherWebSessions(userId, webToken);
  await log(userId, "logout_all", true, client);
  return ended;
}

/**
 * Владелец открыл карточку человека или группы — запись в журнал консоли
 * (кто, чью, когда, с какого устройства). Пишется только из открытой
 * консоли: гейт проверяет сессию раньше, чем страница читает данные.
 */
export async function logOwnerView(
  ownerId: number,
  event: repo.OwnerViewEvent,
  targetId: number,
  client: ClientInfo,
): Promise<void> {
  await repo.logOwnerEvent({ userId: ownerId, event, ok: true, targetId, ...fingerprint(client) });
}
