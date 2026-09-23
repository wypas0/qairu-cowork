/** Подписка на личный календарь (.ics). */

import "server-only";

import type { DateStr } from "@/core/timeutils";
import { and, eq, gte, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { busySlots, users } from "../schema";
import { type Exec, ex } from "./base";
import { markFilled } from "./schedule";

// --------------------------------------------------------------------------
// Подписка на личный календарь (.ics)
// --------------------------------------------------------------------------

/** Источник занятости, пришедшей из календаря по ссылке. */
export const CALENDAR_SOURCE = "ics";

/** Сохранить или снять ссылку на календарь. Без ссылки занятость из него стирается. */
export async function setCalendarUrl(userId: number, url: string | null, exec?: Exec): Promise<void> {
  const db = ex(exec);
  await db
    .update(users)
    .set({ calendarUrl: url, calendarSyncedAt: null, calendarError: null })
    .where(eq(users.userId, userId));
  if (url === null) {
    await db.delete(busySlots).where(and(eq(busySlots.userId, userId), eq(busySlots.source, CALENDAR_SOURCE)));
  }
}

/** Итог последней загрузки: время успеха или код ошибки. */
export async function setCalendarStatus(
  userId: number,
  status: { syncedAt?: Date; error: string | null },
  exec?: Exec,
): Promise<void> {
  await ex(exec)
    .update(users)
    .set({ calendarError: status.error, ...(status.syncedAt ? { calendarSyncedAt: status.syncedAt } : {}) })
    .where(eq(users.userId, userId));
}

/**
 * Заменить занятость из календаря целиком: календарь — источник правды,
 * удалённое там событие должно пропасть и здесь.
 */
export async function replaceCalendarSlots(
  userId: number,
  pieces: readonly { day: DateStr; start: number; end: number }[],
  exec?: Exec,
): Promise<void> {
  const db = ex(exec);
  await db.delete(busySlots).where(and(eq(busySlots.userId, userId), eq(busySlots.source, CALENDAR_SOURCE)));
  if (pieces.length > 0) {
    await db.insert(busySlots).values(
      pieces.map((piece) => ({
        userId,
        specificDate: piece.day,
        startMin: piece.start,
        endMin: piece.end,
        label: "",
        kind: "other",
        source: CALENDAR_SOURCE,
      })),
    );
  }
  await markFilled(userId, true, db);
}

/** Сколько занятий из календаря впереди — для строки состояния. */
export async function calendarSlotCount(userId: number, fromDay: DateStr, exec?: Exec): Promise<number> {
  const [row] = await ex(exec)
    .select({ count: sql<number>`count(*)::int` })
    .from(busySlots)
    .where(
      and(
        eq(busySlots.userId, userId),
        eq(busySlots.source, CALENDAR_SOURCE),
        gte(busySlots.specificDate, fromDay),
      ),
    );
  return row?.count ?? 0;
}

/** Календари, которые давно не обновлялись: сначала никогда не загруженные. */
export async function staleCalendars(
  before: Date,
  limit: number,
  exec?: Exec,
): Promise<{ userId: number; calendarUrl: string }[]> {
  const rows = await ex(exec)
    .select({ userId: users.userId, calendarUrl: users.calendarUrl })
    .from(users)
    .where(
      and(
        isNotNull(users.calendarUrl),
        or(isNull(users.calendarSyncedAt), lt(users.calendarSyncedAt, before)),
      ),
    )
    .orderBy(sql`${users.calendarSyncedAt} asc nulls first`)
    .limit(limit);
  return rows.map((row) => ({ userId: row.userId, calendarUrl: row.calendarUrl! }));
}
