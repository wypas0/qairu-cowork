import type { NextRequest } from "next/server";

import { cleanIncomingSlots } from "@/core/grid";
import * as repo from "@/db/repo";
import { currentTelegramUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Сохранить недельную занятость. Тело: {"slots": [{weekday,start,end,label,parity,kind}]} */
export async function POST(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const chat = await repo.getChatBySlug(slug);
  if (!chat) return Response.json({ detail: "not found" }, { status: 404 });

  const user = await currentTelegramUser();
  if (!user || !(await repo.isMember(chat.chatId, user.userId))) {
    return Response.json({ detail: "not a member" }, { status: 403 });
  }

  let payload: { slots?: unknown };
  try {
    payload = (await request.json()) as { slots?: unknown };
  } catch {
    return Response.json({ detail: "bad request" }, { status: 400 });
  }

  const cleaned = cleanIncomingSlots(payload.slots);
  await repo.replaceWeeklySlots(user.userId, [0, 1, 2, 3, 4, 5, 6], cleaned, "web");
  return Response.json({ ok: true, saved: cleaned.length });
}
