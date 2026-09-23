import { buildIcs } from "@/core/calendar";
import { chatTz } from "@/core/timeutils";
import * as repo from "@/db/repo";
import { meetingEvent } from "@/lib/group";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Встреча файлом для календаря: `/g/<slug>/meetings/<id>.ics`.
 *
 * Расширение остаётся частью сегмента — так адрес совпадает с прежней
 * FastAPI-версией, и ссылки из старых сообщений не ломаются.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await context.params;
  const meetingId = Number(id.replace(/\.ics$/i, ""));
  if (!Number.isInteger(meetingId)) {
    return Response.json({ detail: "no calendar data" }, { status: 404 });
  }

  const chat = await repo.getChatBySlug(slug);
  if (!chat) return Response.json({ detail: "not found" }, { status: 404 });

  const meeting = await repo.getMeeting(meetingId);
  if (!meeting || meeting.chatId !== chat.chatId || !meeting.whenStart) {
    return Response.json({ detail: "no calendar data" }, { status: 404 });
  }

  const payload = buildIcs(
    meetingEvent({ ...meeting, whenStart: meeting.whenStart }, chatTz(chat), {
      summary: meeting.goal || chat.title,
      description: meeting.goal,
    }),
  );

  return new Response(payload, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="qairu-${meetingId}.ics"`,
    },
  });
}
