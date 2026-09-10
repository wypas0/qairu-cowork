import type { NextRequest } from "next/server";

import { fmtMinutes } from "@/core/intervals";
import { parseAny, parseResultOk } from "@/core/parser";
import * as repo from "@/db/repo";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Разбор расписания из свободного текста — тем же парсером, что и в боте. */
export async function POST(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const chat = await repo.getChatBySlug(slug);
  if (!chat) return Response.json({ detail: "not found" }, { status: 404 });

  const user = await currentUser();
  if (!user || !(await repo.isMember(chat.chatId, user.userId))) {
    return Response.json({ detail: "not a member" }, { status: 403 });
  }

  let payload: { text?: unknown };
  try {
    payload = (await request.json()) as { text?: unknown };
  } catch {
    return Response.json({ detail: "bad request" }, { status: 400 });
  }

  const parsed = parseAny(String(payload.text ?? "").slice(0, 8000));
  return Response.json({
    ok: parseResultOk(parsed),
    slots: parsed.slots.map((slot) => ({
      weekday: slot.weekday,
      start: slot.startMin,
      end: slot.endMin,
      label: slot.label,
      parity: slot.parity,
      kind: slot.kind,
      text: `${fmtMinutes(slot.startMin)}–${fmtMinutes(slot.endMin)}`,
    })),
    free_days: parsed.freeDays,
    errors: parsed.errors.slice(0, 5),
  });
}
