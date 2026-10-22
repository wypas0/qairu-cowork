import { buildIcs } from "@/core/calendar";
import * as repo from "@/db/repo";
import { displayName } from "@/db/schema";
import { t } from "@/i18n";
import { currentUser } from "@/lib/auth";
import { defaultTz } from "@/lib/config";
import { meetingEvent } from "@/lib/group";
import { pairMeetingWith } from "@/lib/pairMeetings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Встреча вдвоём файлом для календаря: `/friends/<id друга>/meetings/<id>.ics`.
 * Только своя встреча с этим другом — чужая отвечает так же, как несуществующая.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string; meeting: string }> }) {
  const { id, meeting: raw } = await context.params;
  const meetingId = Number(raw.replace(/\.ics$/i, ""));
  const user = await currentUser();
  const meeting = user && Number.isInteger(meetingId) ? await pairMeetingWith(user, Number(id), meetingId) : null;
  if (!user || !meeting?.whenStart) return Response.json({ detail: "no calendar data" }, { status: 404 });

  const friend = await repo.getUser(Number(id));
  const withName = t(user.lang, "ics_pair_with", { name: friend ? displayName(friend) : "—" });
  const payload = buildIcs(
    meetingEvent({ ...meeting, whenStart: meeting.whenStart }, defaultTz(), {
      summary: meeting.goal || withName,
      description: withName,
    }),
  );
  return new Response(payload, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="qairu-${meetingId}.ics"`,
    },
  });
}
