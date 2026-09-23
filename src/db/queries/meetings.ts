/** Встречи, ответы на них, напоминания. */

import "server-only";

import { TIMELESS_MEETING_DAYS } from "@/core/recurrence";
import type { DateStr } from "@/core/timeutils";
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, ne, not, or, sql } from "drizzle-orm";
import { type Chat, chats, type Meeting, type MeetingResponse, meetingResponses, meetings, memberships, notices } from "../schema";
import { type Exec, ex } from "./base";

// --------------------------------------------------------------------------
// Встречи
// --------------------------------------------------------------------------

export async function createMeeting(
  args: {
    chatId: number;
    initiatorId: number;
    place: string;
    whenText: string;
    goal: string;
    invitees: number[];
    whenStart?: Date | null;
    /** Сколько длится встреча, минуты; без точного времени начала не сохраняется. */
    durationMin?: number | null;
    /** Повторять каждую неделю до этой даты включительно. */
    repeatUntil?: DateStr | null;
  },
  exec?: Exec,
): Promise<Meeting> {
  const [row] = await ex(exec)
    .insert(meetings)
    .values({
      chatId: args.chatId,
      initiatorId: args.initiatorId,
      place: args.place.slice(0, 256),
      whenText: args.whenText.slice(0, 256),
      goal: args.goal,
      invitees: args.invitees.join(","),
      whenStart: args.whenStart ?? null,
      durationMin: args.whenStart ? (args.durationMin ?? null) : null,
      // Повторять можно только встречу с точным временем.
      repeatUntil: args.whenStart ? (args.repeatUntil ?? null) : null,
    })
    .returning();
  return row;
}

/**
 * Сколько в каждой группе ждёт человека: встречи, на которые он приглашён и
 * ещё не ответил, плюс непрочитанные уведомления (просьба заполнить
 * расписание, предложение перенести встречу). Приглашение на встречу — это
 * и уведомление тоже, поэтому уведомления о встречах не считаем дважды.
 */
export async function pendingCounts(userId: number, exec?: Exec): Promise<Map<number, number>> {
  const db = ex(exec);
  const counts = new Map<number, number>();
  const bump = (chatId: number) => counts.set(chatId, (counts.get(chatId) ?? 0) + 1);

  const open = await db
    .select({ id: meetings.id, chatId: meetings.chatId, invitees: meetings.invitees })
    .from(meetings)
    .innerJoin(
      memberships,
      and(eq(memberships.chatId, meetings.chatId), eq(memberships.userId, userId)),
    )
    .where(
      and(
        eq(meetings.status, "open"),
        or(
          isNull(meetings.whenStart),
          gt(meetings.whenStart, new Date()),
          // Серия ещё идёт, даже если первая встреча уже была.
          gte(meetings.repeatUntil, new Date().toISOString().slice(0, 10)),
        ),
      ),
    );
  const invited = open.filter((meeting) => inviteeIds(meeting).includes(userId));
  if (invited.length > 0) {
    const answered = await db
      .select({ meetingId: meetingResponses.meetingId })
      .from(meetingResponses)
      .where(
        and(
          eq(meetingResponses.userId, userId),
          inArray(
            meetingResponses.meetingId,
            invited.map((meeting) => meeting.id),
          ),
        ),
      );
    const done = new Set(answered.map((row) => row.meetingId));
    for (const meeting of invited) if (!done.has(meeting.id)) bump(meeting.chatId);
  }

  const unread = await db
    .select({ chatId: notices.chatId, kind: notices.kind })
    .from(notices)
    .where(and(eq(notices.userId, userId), isNull(notices.readAt)));
  for (const notice of unread) if (notice.kind !== "meeting") bump(notice.chatId);

  return counts;
}

/** Открытые встречи с точным временем в этих группах, начиная с `since`, — для ленты календаря. */
export async function feedMeetings(chatIds: number[], since: Date, exec?: Exec): Promise<Meeting[]> {
  if (chatIds.length === 0) return [];
  return ex(exec)
    .select()
    .from(meetings)
    .where(
      and(
        inArray(meetings.chatId, chatIds),
        eq(meetings.status, "open"),
        isNotNull(meetings.whenStart),
        or(gte(meetings.whenStart, since), gte(meetings.repeatUntil, since.toISOString().slice(0, 10))),
      ),
    )
    .orderBy(asc(meetings.whenStart))
    .limit(300);
}

export function inviteeIds(meeting: Pick<Meeting, "invitees">): number[] {
  return meeting.invitees
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map(Number)
    .filter((value) => Number.isFinite(value));
}

export async function getMeeting(meetingId: number, exec?: Exec): Promise<Meeting | null> {
  const [row] = await ex(exec).select().from(meetings).where(eq(meetings.id, meetingId)).limit(1);
  return row ?? null;
}

export async function updateMeeting(
  meetingId: number,
  patch: Partial<typeof meetings.$inferInsert>,
  exec?: Exec,
): Promise<void> {
  await ex(exec).update(meetings).set(patch).where(eq(meetings.id, meetingId));
}

/**
 * Записать итоги встречи. Возвращает, были ли итоги пустыми до этого:
 * рассылать их нужно один раз, а не после каждой правки опечатки.
 */
export async function setMeetingSummary(
  meetingId: number,
  summary: string,
  userId: number,
  exec?: Exec,
): Promise<{ first: boolean }> {
  const db = ex(exec);
  const [before] = await db
    .select({ summary: meetings.summary })
    .from(meetings)
    .where(eq(meetings.id, meetingId))
    .limit(1);
  const text = summary.trim().slice(0, 2000);
  await db
    .update(meetings)
    .set({ summary: text, summaryBy: text ? userId : null, summaryAt: text ? new Date() : null })
    .where(eq(meetings.id, meetingId));
  return { first: Boolean(text) && !before?.summary };
}

export async function setResponse(
  args: { meetingId: number; userId: number; answer: string; comment?: string },
  exec?: Exec,
): Promise<void> {
  const set: Record<string, unknown> = { answer: args.answer, respondedAt: new Date() };
  if (args.comment) set.comment = args.comment;

  await ex(exec)
    .insert(meetingResponses)
    .values({
      meetingId: args.meetingId,
      userId: args.userId,
      answer: args.answer,
      comment: args.comment ?? "",
    })
    .onConflictDoUpdate({
      target: [meetingResponses.meetingId, meetingResponses.userId],
      set,
    });
}

export async function meetingResponsesFor(
  meetingId: number,
  exec?: Exec,
): Promise<MeetingResponse[]> {
  return ex(exec)
    .select()
    .from(meetingResponses)
    .where(eq(meetingResponses.meetingId, meetingId));
}

export async function meetingResponsesForMany(
  meetingIds: number[],
  exec?: Exec,
): Promise<Map<number, MeetingResponse[]>> {
  const result = new Map<number, MeetingResponse[]>();
  if (meetingIds.length === 0) return result;
  const rows = await ex(exec)
    .select()
    .from(meetingResponses)
    .where(inArray(meetingResponses.meetingId, meetingIds));
  for (const id of meetingIds) result.set(id, []);
  for (const row of rows) result.get(row.meetingId)?.push(row);
  return result;
}

export async function chatMeetings(chatId: number, limit = 20, exec?: Exec): Promise<Meeting[]> {
  return ex(exec)
    .select()
    .from(meetings)
    .where(eq(meetings.chatId, chatId))
    .orderBy(desc(meetings.createdAt))
    .limit(limit);
}

/**
 * Встречи для вкладки «Встречи»: все предстоящие и `archive` последних прошедших.
 *
 * Раньше бралось 10 последних созданных, и давно назначенная встреча пропадала
 * из списка, стоило создать ещё десяток. «Предстоящая» — то же условие, что
 * meetingIsOver в core/recurrence, только наоборот и в SQL. Каждая ветка
 * защищена от NULL: иначе NOT(...) дал бы NULL, и встреча не попала бы никуда.
 */
export async function chatMeetingsForTab(
  chatId: number,
  now: Date,
  today: DateStr,
  archive = 10,
  exec?: Exec,
): Promise<Meeting[]> {
  const timelessSince = new Date(now.getTime() - TIMELESS_MEETING_DAYS * 86_400_000);
  const upcoming = and(
    ne(meetings.status, "cancelled"),
    or(
      and(isNotNull(meetings.repeatUntil), gte(meetings.repeatUntil, today)),
      and(isNull(meetings.repeatUntil), isNotNull(meetings.whenStart), gte(meetings.whenStart, now)),
      and(isNull(meetings.repeatUntil), isNull(meetings.whenStart), gte(meetings.createdAt, timelessSince)),
    ),
  )!;
  const ahead = await ex(exec)
    .select()
    .from(meetings)
    .where(and(eq(meetings.chatId, chatId), upcoming))
    .orderBy(asc(meetings.whenStart))
    .limit(200);
  const past = await ex(exec)
    .select()
    .from(meetings)
    .where(and(eq(meetings.chatId, chatId), not(upcoming)))
    .orderBy(desc(sql`coalesce(${meetings.whenStart}, ${meetings.createdAt})`))
    .limit(archive);
  return [...ahead, ...past];
}

/** Открытые встречи группы с точным временем начала в промежутке [from, to). */
export async function openMeetingsBetween(
  chatId: number,
  from: Date,
  to: Date,
  exec?: Exec,
): Promise<Meeting[]> {
  return ex(exec)
    .select()
    .from(meetings)
    .where(
      and(
        eq(meetings.chatId, chatId),
        eq(meetings.status, "open"),
        isNotNull(meetings.whenStart),
        isNull(meetings.repeatUntil),
        gte(meetings.whenStart, from),
        lt(meetings.whenStart, to),
      ),
    )
    .orderBy(asc(meetings.whenStart))
    .limit(100);
}

/**
 * Повторяющиеся встречи группы, у которых могут быть повторы в [с дня `fromDay`, до `to`):
 * серия началась раньше `to` и ещё не закончилась к `fromDay`.
 */
export async function recurringMeetings(
  chatId: number,
  fromDay: DateStr,
  to: Date,
  exec?: Exec,
): Promise<Meeting[]> {
  return ex(exec)
    .select()
    .from(meetings)
    .where(
      and(
        eq(meetings.chatId, chatId),
        eq(meetings.status, "open"),
        isNotNull(meetings.whenStart),
        isNotNull(meetings.repeatUntil),
        gte(meetings.repeatUntil, fromDay),
        lt(meetings.whenStart, to),
      ),
    )
    .limit(100);
}

/** Открытые встречи во всех группах пользователя — для профильной панели. */
export async function userMeetings(
  userId: number,
  limit = 20,
  exec?: Exec,
): Promise<{ meeting: Meeting; chat: Chat }[]> {
  return ex(exec)
    .select({ meeting: meetings, chat: chats })
    .from(meetings)
    .innerJoin(chats, eq(chats.chatId, meetings.chatId))
    .innerJoin(memberships, eq(memberships.chatId, chats.chatId))
    .where(and(eq(memberships.userId, userId), eq(meetings.status, "open")))
    .orderBy(desc(meetings.createdAt))
    .limit(limit);
}

/**
 * Открытые встречи, которым пора отправить напоминание.
 *
 * Порог «за N минут» живёт у чата, поэтому условие считается прямо в SQL:
 * встреча ещё не наступила, но до неё осталось не больше `reminder_min`.
 */
export async function meetingsDueForReminder(
  now: Date,
  exec?: Exec,
): Promise<{ meeting: Meeting; chat: Chat }[]> {
  return ex(exec)
    .select({ meeting: meetings, chat: chats })
    .from(meetings)
    .innerJoin(chats, eq(chats.chatId, meetings.chatId))
    .where(
      and(
        eq(meetings.status, "open"),
        eq(meetings.reminderSent, false),
        isNotNull(meetings.whenStart),
        isNull(meetings.repeatUntil),
        sql`${chats.reminderMin} > 0`,
        gt(meetings.whenStart, now),
        // Внутри sql-фрагмента момент передаётся строкой с явным приведением:
        // «голый» Date здесь — параметр без типа, и драйвер postgres.js на нём падает.
        sql`${meetings.whenStart} <= ${now.toISOString()}::timestamptz
            + make_interval(mins => ${chats.reminderMin})`,
      ),
    );
}

/**
 * Живые серии повторяющихся встреч в группах с напоминаниями. Какой повтор
 * ближайший и пора ли о нём напомнить, решает вызывающий: это зависит от пояса группы.
 */
export async function recurringReminderCandidates(
  today: DateStr,
  exec?: Exec,
): Promise<{ meeting: Meeting; chat: Chat }[]> {
  return ex(exec)
    .select({ meeting: meetings, chat: chats })
    .from(meetings)
    .innerJoin(chats, eq(chats.chatId, meetings.chatId))
    .where(
      and(
        eq(meetings.status, "open"),
        isNotNull(meetings.whenStart),
        isNotNull(meetings.repeatUntil),
        gte(meetings.repeatUntil, today),
        sql`${chats.reminderMin} > 0`,
      ),
    );
}
