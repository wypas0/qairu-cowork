import type { NextRequest } from "next/server";

import { buildFeed } from "@/core/calendar";
import { weeklyRule } from "@/core/recurrence";
import { type DateStr, chatTz } from "@/core/timeutils";
import * as repo from "@/db/repo";
import { verifyFeedToken } from "@/lib/calendarFeed";
import { meetingSpan } from "@/lib/group";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Прошедшие встречи держим в ленте месяц — чтобы они не пропадали из календаря сразу. */
const KEEP_PAST_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Лента встреч для подписки в календаре: `/api/calendar/<токен>.ics[?g=<код>]`.
 *
 * Открывается без входа — её забирает сервер календаря. Доступ даёт подписанный
 * токен (см. lib/calendarFeed), а показываем только группы, где человек состоит.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const userId = verifyFeedToken(token.replace(/\.ics$/i, ""));
  if (userId === null) return new Response("not found", { status: 404 });

  const only = request.nextUrl.searchParams.get("g")?.toLowerCase() ?? null;
  const chats = (await repo.userChats(userId)).filter((chat) => !only || chat.slug === only);
  if (only && chats.length === 0) return new Response("not found", { status: 404 });

  const byId = new Map(chats.map((chat) => [chat.chatId, chat]));
  const meetings = await repo.feedMeetings([...byId.keys()], new Date(Date.now() - KEEP_PAST_MS));

  const events = meetings.flatMap((meeting) => {
    const chat = byId.get(meeting.chatId);
    const span = chat ? meetingSpan(meeting, chatTz(chat)) : null;
    if (!chat || !span || !meeting.whenStart) return [];
    return [
      {
        uid: `meeting-${meeting.id}`,
        summary: meeting.goal || chat.title,
        start: meeting.whenStart,
        durationMin: span.end - span.start,
        location: meeting.place,
        description: chat.title,
        rrule: meeting.repeatUntil ? weeklyRule(meeting.repeatUntil as DateStr, chatTz(chat)) : undefined,
      },
    ];
  });

  const name = only && chats[0] ? `QairuCowork · ${chats[0].title}` : "QairuCowork";
  return new Response(buildFeed({ name, events }), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "private, max-age=300",
    },
  });
}
