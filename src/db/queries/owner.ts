/** Консоль владельца: одноразовые коды, сессии консоли, журнал входов, отметка cron. */

import "server-only";

import { and, desc, eq, gt, inArray, isNotNull, lt, notInArray, sql } from "drizzle-orm";
import { chats, ownerAudit, ownerLoginCodes, ownerSessions, users } from "../schema";
import { type Exec, ex } from "./base";
import { getBotState, setBotState } from "./botState";

// --------------------------------------------------------------------------
// Одноразовые коды
// --------------------------------------------------------------------------

/** Записать новый код владельца вместо прежнего: живой код у человека один. */
export async function storeOwnerCode(
  args: { userId: number; codeHash: string; salt: string; expiresAt: Date },
  exec?: Exec,
): Promise<void> {
  const values = { ...args, attempts: 0, createdAt: new Date() };
  await ex(exec)
    .insert(ownerLoginCodes)
    .values(values)
    .onConflictDoUpdate({ target: ownerLoginCodes.userId, set: values });
}

/** Живой код владельца (для страницы: показать поле ввода и срок). Сам хеш наружу не нужен. */
export async function pendingOwnerCode(
  userId: number,
  now = new Date(),
  exec?: Exec,
): Promise<{ expiresAt: Date; attempts: number } | null> {
  const [row] = await ex(exec)
    .select({ expiresAt: ownerLoginCodes.expiresAt, attempts: ownerLoginCodes.attempts })
    .from(ownerLoginCodes)
    .where(and(eq(ownerLoginCodes.userId, userId), gt(ownerLoginCodes.expiresAt, now)))
    .limit(1);
  return row ?? null;
}

/**
 * Засчитать попытку ввода и вернуть код — одной инструкцией. Попытка
 * засчитывается до сравнения: пачка одновременных запросов не проскочит лимит,
 * каждый увидит уже увеличенный счётчик (как bumpCounter).
 */
export async function bumpOwnerCodeAttempt(
  userId: number,
  exec?: Exec,
): Promise<{ codeHash: string; salt: string; attempts: number; expiresAt: Date } | null> {
  const [row] = await ex(exec)
    .update(ownerLoginCodes)
    .set({ attempts: sql`${ownerLoginCodes.attempts} + 1` })
    .where(eq(ownerLoginCodes.userId, userId))
    .returning({
      codeHash: ownerLoginCodes.codeHash,
      salt: ownerLoginCodes.salt,
      attempts: ownerLoginCodes.attempts,
      expiresAt: ownerLoginCodes.expiresAt,
    });
  return row ?? null;
}

/**
 * Забрать код: удаляется, только если хеш тот же. Из двух одновременных
 * верных вводов сессию получит один — второй увидит false.
 */
export async function takeOwnerCode(userId: number, codeHash: string, exec?: Exec): Promise<boolean> {
  const rows = await ex(exec)
    .delete(ownerLoginCodes)
    .where(and(eq(ownerLoginCodes.userId, userId), eq(ownerLoginCodes.codeHash, codeHash)))
    .returning({ userId: ownerLoginCodes.userId });
  return rows.length > 0;
}

export async function deleteOwnerCode(userId: number, exec?: Exec): Promise<void> {
  await ex(exec).delete(ownerLoginCodes).where(eq(ownerLoginCodes.userId, userId));
}

// --------------------------------------------------------------------------
// Сессии консоли
// --------------------------------------------------------------------------

export async function insertOwnerSession(
  args: { tokenHash: string; userId: number; webTokenHash: string; expiresAt: Date },
  exec?: Exec,
): Promise<void> {
  await ex(exec).insert(ownerSessions).values(args);
}

export async function ownerSessionByHash(
  tokenHash: string,
  now = new Date(),
  exec?: Exec,
): Promise<{ userId: number; webTokenHash: string; createdAt: Date; expiresAt: Date } | null> {
  const [row] = await ex(exec)
    .select({
      userId: ownerSessions.userId,
      webTokenHash: ownerSessions.webTokenHash,
      createdAt: ownerSessions.createdAt,
      expiresAt: ownerSessions.expiresAt,
    })
    .from(ownerSessions)
    .where(and(eq(ownerSessions.tokenHash, tokenHash), gt(ownerSessions.expiresAt, now)))
    .limit(1);
  return row ?? null;
}

export async function deleteOwnerSession(tokenHash: string, exec?: Exec): Promise<void> {
  await ex(exec).delete(ownerSessions).where(eq(ownerSessions.tokenHash, tokenHash));
}

/** Завершить все сессии консоли человека. Возвращает, сколько было. */
export async function deleteOwnerSessionsOf(userId: number, exec?: Exec): Promise<number> {
  const rows = await ex(exec)
    .delete(ownerSessions)
    .where(eq(ownerSessions.userId, userId))
    .returning({ tokenHash: ownerSessions.tokenHash });
  return rows.length;
}

export async function countOwnerSessions(userId: number, now = new Date(), exec?: Exec): Promise<number> {
  const [row] = await ex(exec)
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(ownerSessions)
    .where(and(eq(ownerSessions.userId, userId), gt(ownerSessions.expiresAt, now)));
  return row?.n ?? 0;
}

// --------------------------------------------------------------------------
// Журнал
// --------------------------------------------------------------------------

export type OwnerEvent =
  | "code_sent"
  | "send_failed"
  | "login"
  | "wrong"
  | "expired"
  | "locked"
  | "throttled"
  | "logout"
  | "logout_all"
  | OwnerViewEvent;

/** Просмотр карточки в консоли: человека или группы. */
export type OwnerViewEvent = "user_view" | "group_view";
export const OWNER_VIEW_EVENTS: OwnerViewEvent[] = ["user_view", "group_view"];

export type OwnerAuditRow = {
  event: OwnerEvent;
  ok: boolean;
  ipHash: string;
  device: string;
  createdAt: Date;
};

export async function logOwnerEvent(
  args: {
    userId: number;
    event: OwnerEvent;
    ok: boolean;
    ipHash: string;
    uaHash: string;
    device: string;
    targetId?: number | null;
  },
  exec?: Exec,
): Promise<void> {
  await ex(exec)
    .insert(ownerAudit)
    .values({ ...args, targetId: args.targetId ?? null, device: args.device.slice(0, 48) });
}

/** Входы и выходы — без просмотров карточек: те в своём списке. */
export async function recentOwnerEvents(limit = 12, exec?: Exec): Promise<OwnerAuditRow[]> {
  const rows = await ex(exec)
    .select({
      event: ownerAudit.event,
      ok: ownerAudit.ok,
      ipHash: ownerAudit.ipHash,
      device: ownerAudit.device,
      createdAt: ownerAudit.createdAt,
    })
    .from(ownerAudit)
    .where(notInArray(ownerAudit.event, OWNER_VIEW_EVENTS))
    .orderBy(desc(ownerAudit.createdAt), desc(ownerAudit.id))
    .limit(limit);
  return rows as OwnerAuditRow[];
}

export type OwnerViewRow = {
  event: OwnerViewEvent;
  targetId: number;
  /** Имя человека или название группы на сейчас; null — уже удалены. */
  name: string | null;
  device: string;
  createdAt: Date;
};

/** Какие карточки открывались в консоли, свежие сверху — с именами одним запросом. */
export async function recentOwnerViews(limit = 20, exec?: Exec): Promise<OwnerViewRow[]> {
  const rows = await ex(exec)
    .select({
      event: ownerAudit.event,
      targetId: ownerAudit.targetId,
      device: ownerAudit.device,
      createdAt: ownerAudit.createdAt,
      name: sql<string | null>`case
        when ${ownerAudit.event} = 'user_view' then
          coalesce(nullif(${users.realName}, ''), nullif(${users.fullName}, ''), '@' || ${users.username})
        else ${chats.title} end`,
    })
    .from(ownerAudit)
    .leftJoin(users, and(eq(ownerAudit.event, "user_view"), eq(users.userId, ownerAudit.targetId)))
    .leftJoin(chats, and(eq(ownerAudit.event, "group_view"), eq(chats.chatId, ownerAudit.targetId)))
    .where(and(inArray(ownerAudit.event, OWNER_VIEW_EVENTS), isNotNull(ownerAudit.targetId)))
    .orderBy(desc(ownerAudit.createdAt), desc(ownerAudit.id))
    .limit(limit);
  return rows.map((row) => ({
    event: row.event as OwnerViewEvent,
    targetId: Number(row.targetId),
    name: row.name ?? null,
    device: row.device,
    createdAt: row.createdAt,
  }));
}

/** Журнал хранится столько дней. */
export const OWNER_AUDIT_DAYS = 90;

/**
 * Уборка: протухшие коды и сессии, журнал старше OWNER_AUDIT_DAYS. Вызывается
 * при входе в консоль — отдельный cron ради нескольких строк не нужен.
 */
export async function pruneOwnerTables(now = new Date(), exec?: Exec): Promise<void> {
  const db = ex(exec);
  await db.delete(ownerLoginCodes).where(lt(ownerLoginCodes.expiresAt, now));
  await db.delete(ownerSessions).where(lt(ownerSessions.expiresAt, now));
  await db
    .delete(ownerAudit)
    .where(lt(ownerAudit.createdAt, new Date(now.getTime() - OWNER_AUDIT_DAYS * 86_400_000)));
}

// --------------------------------------------------------------------------
// Последний прогон cron напоминаний
// --------------------------------------------------------------------------

const CRON_KEY = "cron:reminders";
const CRON_WEEK_MS = 7 * 86_400_000;

/** Что сделал последний прогон и сколько напоминаний ушло за неделю — для консоли. */
export type CronRun = {
  at: number;
  ok: boolean;
  due: number;
  sent: number;
  attendance: number;
  calendars: number;
  sessions: number;
  /** Итоги за скользящее окно с `since`: сколько напоминаний было к отправке и сколько дошло. */
  week: { since: number; due: number; sent: number };
};

/**
 * Отметить прогон cron. Одна запись в bot_state на прогон (раз в 10 минут),
 * а не на просмотр страницы. Прочитать → дописать → записать: прогоны идут
 * друг за другом, гонки тут нет.
 */
export async function recordCronRun(
  run: Omit<CronRun, "week">,
  exec?: Exec,
): Promise<void> {
  const previous = await getBotState<CronRun>(CRON_KEY, exec);
  const fresh = !previous?.week || run.at - previous.week.since > CRON_WEEK_MS;
  const week = fresh
    ? { since: run.at, due: run.due, sent: run.sent }
    : { since: previous.week.since, due: previous.week.due + run.due, sent: previous.week.sent + run.sent };
  await setBotState(CRON_KEY, { ...run, week } satisfies CronRun, exec);
}

export async function lastCronRun(exec?: Exec): Promise<CronRun | null> {
  return getBotState<CronRun>(CRON_KEY, exec);
}
