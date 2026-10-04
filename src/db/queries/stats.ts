/** Статистика для владельца сайта (/admin/stats): только счётчики по своим таблицам, без трекеров. */

import "server-only";

import { and, count, eq, gte, isNotNull, sql } from "drizzle-orm";
import { chats, meetingAttendance, meetingResponses, meetings, memberships, scheduleState, users, webSessions } from "../schema";
import { type Exec, ex } from "./base";

export type SiteStats = {
  users: { total: number; newWeek: number; activeWeek: number; activeMonth: number };
  groups: { total: number; withTwoPlus: number; withMeetingMonth: number };
  schedule: {
    filled: number;
    origins: { origin: string; count: number }[];
    versions: { version: string; count: number }[];
  };
  meetings: { total: number; week: number; month: number; responses: number; asked: number; attended: number };
};

const DAY = 86_400_000;

export async function siteStats(now = new Date(), exec?: Exec): Promise<SiteStats> {
  const db = ex(exec);
  const week = new Date(now.getTime() - 7 * DAY);
  const month = new Date(now.getTime() - 30 * DAY);
  const one = async <T extends { n: number }>(query: Promise<T[]>) => (await query)[0]?.n ?? 0;
  const n = () => count().mapWith(Number);
  const distinctUsers = sql<number>`count(distinct ${webSessions.userId})`.mapWith(Number);

  const [
    usersTotal,
    usersNew,
    activeWeek,
    activeMonth,
    groupsTotal,
    groupsTwoPlus,
    groupsMeeting,
    filled,
    origins,
    versions,
    meetingsTotal,
    meetingsWeek,
    meetingsMonth,
    responses,
    asked,
    attended,
  ] = await Promise.all([
    one(db.select({ n: n() }).from(users)),
    one(db.select({ n: n() }).from(users).where(gte(users.createdAt, week))),
    one(db.select({ n: distinctUsers }).from(webSessions).where(gte(webSessions.lastSeenAt, week))),
    one(db.select({ n: distinctUsers }).from(webSessions).where(gte(webSessions.lastSeenAt, month))),
    one(db.select({ n: n() }).from(chats)),
    one(
      db
        .select({ n: sql<number>`count(*)`.mapWith(Number) })
        .from(
          db
            .select({ chatId: memberships.chatId })
            .from(memberships)
            .groupBy(memberships.chatId)
            .having(sql`count(*) >= 2`)
            .as("busy_groups"),
        ),
    ),
    one(
      db
        .select({ n: sql<number>`count(distinct ${meetings.chatId})`.mapWith(Number) })
        .from(meetings)
        .where(gte(meetings.createdAt, month)),
    ),
    one(db.select({ n: n() }).from(scheduleState).where(eq(scheduleState.filled, true))),
    db
      .select({ origin: scheduleState.origin, count: n() })
      .from(scheduleState)
      .where(eq(scheduleState.filled, true))
      .groupBy(scheduleState.origin),
    db
      .select({ version: sql<string>`${scheduleState.extVersion}`, count: n() })
      .from(scheduleState)
      .where(and(eq(scheduleState.filled, true), isNotNull(scheduleState.extVersion)))
      .groupBy(scheduleState.extVersion),
    one(db.select({ n: n() }).from(meetings)),
    one(db.select({ n: n() }).from(meetings).where(gte(meetings.createdAt, week))),
    one(db.select({ n: n() }).from(meetings).where(gte(meetings.createdAt, month))),
    one(db.select({ n: n() }).from(meetingResponses)),
    one(db.select({ n: n() }).from(meetingAttendance)),
    one(db.select({ n: n() }).from(meetingAttendance).where(eq(meetingAttendance.attended, true))),
  ]);

  return {
    users: { total: usersTotal, newWeek: usersNew, activeWeek, activeMonth },
    groups: { total: groupsTotal, withTwoPlus: groupsTwoPlus, withMeetingMonth: groupsMeeting },
    schedule: {
      filled,
      origins: origins.sort((a, b) => b.count - a.count),
      versions: versions.sort((a, b) => b.count - a.count),
    },
    meetings: {
      total: meetingsTotal,
      week: meetingsWeek,
      month: meetingsMonth,
      responses,
      asked,
      attended,
    },
  };
}
