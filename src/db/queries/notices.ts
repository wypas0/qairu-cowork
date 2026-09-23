/** Уведомления на сайте. */

import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";
import { type Notice, notices } from "../schema";
import { type Exec, ex } from "./base";

// --------------------------------------------------------------------------
// Уведомления на сайте
// --------------------------------------------------------------------------

export async function addNotices(
  rows: {
    chatId: number;
    userId: number;
    kind: string;
    meetingId?: number | null;
    fromUserId?: number | null;
    text?: string;
  }[],
  exec?: Exec,
): Promise<void> {
  if (rows.length === 0) return;
  await ex(exec)
    .insert(notices)
    .values(
      rows.map((row) => ({
        chatId: row.chatId,
        userId: row.userId,
        kind: row.kind.slice(0, 24),
        meetingId: row.meetingId ?? null,
        fromUserId: row.fromUserId ?? null,
        text: (row.text ?? "").slice(0, 500),
      })),
    );
}

export async function unreadNotices(chatId: number, userId: number, exec?: Exec): Promise<Notice[]> {
  return ex(exec)
    .select()
    .from(notices)
    .where(and(eq(notices.chatId, chatId), eq(notices.userId, userId), isNull(notices.readAt)))
    .orderBy(desc(notices.createdAt))
    .limit(20);
}

/** Закрыть уведомление. Чужое закрыть нельзя. */
export async function markNoticeRead(noticeId: number, userId: number, exec?: Exec): Promise<void> {
  await ex(exec)
    .update(notices)
    .set({ readAt: new Date() })
    .where(and(eq(notices.id, noticeId), eq(notices.userId, userId), isNull(notices.readAt)));
}

/** Человек ответил на встречу — баннер «ответь на встречу» больше не нужен. */
export async function markMeetingNoticesRead(
  meetingId: number,
  userId: number,
  exec?: Exec,
): Promise<void> {
  await ex(exec)
    .update(notices)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notices.meetingId, meetingId),
        eq(notices.userId, userId),
        eq(notices.kind, "meeting"),
        isNull(notices.readAt),
      ),
    );
}

/** Встречу отменили — все её баннеры у всех участников больше не актуальны. */
export async function closeMeetingNotices(meetingId: number, exec?: Exec): Promise<void> {
  await ex(exec)
    .update(notices)
    .set({ readAt: new Date() })
    .where(and(eq(notices.meetingId, meetingId), isNull(notices.readAt)));
}

/** Сохранил расписание — напоминания «заполни расписание» во всех группах гаснут. */
export async function markFillNoticesRead(userId: number, exec?: Exec): Promise<void> {
  await ex(exec)
    .update(notices)
    .set({ readAt: new Date() })
    .where(
      and(eq(notices.userId, userId), eq(notices.kind, "fill_schedule"), isNull(notices.readAt)),
    );
}
