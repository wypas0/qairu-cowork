import type { NextRequest } from "next/server";

import { buildFeed } from "@/core/calendar";
import { pairPartner } from "@/core/pairPlan";
import { chatTz } from "@/core/timeutils";
import * as repo from "@/db/repo";
import { displayName } from "@/db/schema";
import { t } from "@/i18n";
import { verifyFeedToken } from "@/lib/calendarFeed";
import { defaultTz } from "@/lib/config";
import { meetingEvent } from "@/lib/group";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Прошедшие встречи держим в ленте месяц — чтобы они не пропадали из календаря сразу. */
const KEEP_PAST_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Лента встреч для подписки в календаре: `/api/calendar/<токен>.ics[?g=<код>]`.
 *
 * Открывается без входа — её забирает сервер календаря. Доступ даёт подписанный
 * токен (см. lib/calendarFeed), а показываем только группы, где человек состоит.
 * Общая лента (без `g`) — ещё и встречи вдвоём с друзьями.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const userId = verifyFeedToken(token.replace(/\.ics$/i, ""));
  if (userId === null) return new Response("not found", { status: 404 });

  const only = request.nextUrl.searchParams.get("g")?.toLowerCase() ?? null;
  const chats = (await repo.userChats(userId)).filter((chat) => !only || chat.slug === only);
  if (only && chats.length === 0) return new Response("not found", { status: 404 });

  const byId = new Map(chats.map((chat) => [chat.chatId, chat]));
  const since = new Date(Date.now() - KEEP_PAST_MS);
  const [meetings, pairs, owner] = await Promise.all([
    repo.feedMeetings([...byId.keys()], since),
    only ? Promise.resolve([]) : repo.pairMeetingsOf(userId, since),
    repo.getUser(userId),
  ]);

  const events = meetings.flatMap((meeting) => {
    const chat = meeting.chatId !== null ? byId.get(meeting.chatId) : undefined;
    if (!chat || !meeting.whenStart) return [];
    return [
      meetingEvent({ ...meeting, whenStart: meeting.whenStart }, chatTz(chat), {
        summary: meeting.goal || chat.title,
        description: chat.title,
      }),
    ];
  });
  // Встреча вдвоём: в описании — с кем, на языке владельца ленты.
  const partners = await repo.usersByIds(pairs.map((meeting) => pairPartner(meeting, userId) ?? 0));
  const lang = owner?.lang || "ru";
  for (const meeting of pairs) {
    const partner = partners.get(pairPartner(meeting, userId) ?? 0);
    if (!meeting.whenStart || !partner) continue;
    const withName = t(lang, "ics_pair_with", { name: displayName(partner) });
    events.push(
      meetingEvent({ ...meeting, whenStart: meeting.whenStart }, defaultTz(), {
        summary: meeting.goal || withName,
        description: withName,
      }),
    );
  }

  const name = only && chats[0] ? `QairuCowork · ${chats[0].title}` : "QairuCowork";
  return new Response(buildFeed({ name, events }), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "private, max-age=300",
    },
  });
}
