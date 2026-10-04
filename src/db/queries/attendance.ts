/** Был ли человек на встрече; откуда его расписание; сколько он занят — для участников и статистики. */

import "server-only";

import { and, eq, gte, inArray, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import type { DateStr } from "@/core/timeutils";
import { busySlots, meetingAttendance, meetings, scheduleState } from "../schema";
import { type Exec, ex } from "./base";

export type AttendanceRow = { meetingId: number; occurrence: string; userId: number; attended: boolean };

/** Записать ответ «был / не был» (повторный ответ заменяет прежний). */
export async function setAttendance(
  row: { meetingId: number; occurrence: DateStr; userId: number; attended: boolean },
  exec?: Exec,
): Promise<void> {
  await ex(exec)
    .insert(meetingAttendance)
    .values({ ...row, answeredAt: new Date() })
    .onConflictDoUpdate({
      target: [meetingAttendance.meetingId, meetingAttendance.occurrence, meetingAttendance.userId],
      set: { attended: row.attended, answeredAt: new Date() },
    });
}

/** Ответы по встречам: встреча → строки. */
export async function attendanceFor(meetingIds: number[], exec?: Exec): Promise<Map<number, AttendanceRow[]>> {
  const result = new Map<number, AttendanceRow[]>();
  if (meetingIds.length === 0) return result;
  const rows = await ex(exec)
    .select({
      meetingId: meetingAttendance.meetingId,
      occurrence: meetingAttendance.occurrence,
      userId: meetingAttendance.userId,
      attended: meetingAttendance.attended,
    })
    .from(meetingAttendance)
    .where(inArray(meetingAttendance.meetingId, meetingIds));
  for (const row of rows) {
    const list = result.get(row.meetingId) ?? [];
    list.push(row);
    result.set(row.meetingId, list);
  }
  return result;
}

/** По каждому человеку группы: на скольких встречах был из скольких отмеченных. */
export async function attendanceByUser(
  chatId: number,
  exec?: Exec,
): Promise<Map<number, { attended: number; total: number }>> {
  const rows = await ex(exec)
    .select({
      userId: meetingAttendance.userId,
      attended: sql<number>`count(*) filter (where ${meetingAttendance.attended})`.mapWith(Number),
      total: sql<number>`count(*)`.mapWith(Number),
    })
    .from(meetingAttendance)
    .innerJoin(meetings, eq(meetings.id, meetingAttendance.meetingId))
    .where(eq(meetings.chatId, chatId))
    .groupBy(meetingAttendance.userId);
  return new Map(rows.map((row) => [row.userId, { attended: row.attended, total: row.total }]));
}

/** Запомнить, откуда пришло расписание (кампус, фото) и какой версией расширения. */
export async function setScheduleOrigin(
  userId: number,
  origin: "manual" | "photo" | "campus",
  extVersion: string | null,
  exec?: Exec,
): Promise<void> {
  await ex(exec)
    .update(scheduleState)
    .set({ origin, extVersion: origin === "campus" ? extVersion : null })
    .where(eq(scheduleState.userId, userId));
}

/** Откуда у каждого расписание. */
export async function scheduleOrigins(ids: number[], exec?: Exec): Promise<Map<number, string>> {
  if (ids.length === 0) return new Map();
  const rows = await ex(exec)
    .select({ userId: scheduleState.userId, origin: scheduleState.origin })
    .from(scheduleState)
    .where(and(inArray(scheduleState.userId, ids), eq(scheduleState.filled, true)));
  return new Map(rows.map((row) => [row.userId, row.origin]));
}

/**
 * Сколько минут в неделю каждый занят по недельному расписанию — без
 * «неудобно», разовой занятости и календаря.
 */
export async function weeklyBusyMinutes(ids: number[], exec?: Exec): Promise<Map<number, number>> {
  if (ids.length === 0) return new Map();
  const rows = await ex(exec)
    .select({
      userId: busySlots.userId,
      minutes: sql<number>`coalesce(sum(${busySlots.endMin} - ${busySlots.startMin}), 0)`.mapWith(Number),
    })
    .from(busySlots)
    .where(
      and(
        inArray(busySlots.userId, ids),
        isNotNull(busySlots.weekday),
        isNull(busySlots.specificDate),
        isNull(busySlots.dateFrom),
        ne(busySlots.kind, "soft"),
      ),
    )
    .groupBy(busySlots.userId);
  return new Map(rows.map((row) => [row.userId, row.minutes]));
}

/**
 * Встречи, о которых может быть пора спросить «был ли ты»: открытые, с
 * точным временем, начавшиеся до `now`, а серии — ещё не кончившиеся
 * больше суток назад. Какой повтор только что закончился, решает justEnded.
 */
export async function attendanceCandidates(now: Date, yesterday: DateStr, exec?: Exec) {
  return ex(exec)
    .select()
    .from(meetings)
    .where(
      and(
        eq(meetings.status, "open"),
        isNotNull(meetings.whenStart),
        lte(meetings.whenStart, now),
        or(
          and(isNull(meetings.repeatUntil), gte(meetings.whenStart, new Date(now.getTime() - 2 * 86_400_000))),
          gte(meetings.repeatUntil, yesterday),
        ),
      ),
    );
}
