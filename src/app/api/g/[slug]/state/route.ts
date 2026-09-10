import type { NextRequest } from "next/server";

import * as repo from "@/db/repo";
import { currentUser } from "@/lib/auth";
import { loadGroupState, toBoardPayload } from "@/lib/group";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** JSON-версия дашборда — сетка перерисовывается без перезагрузки страницы. */
export async function GET(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const chat = await repo.getChatBySlug(slug);
  if (!chat) return Response.json({ detail: "not found" }, { status: 404 });

  const user = await currentUser();
  if (!user || !(await repo.isMember(chat.chatId, user.userId))) {
    return Response.json({ detail: "not a member" }, { status: 403 });
  }

  const search = request.nextUrl.searchParams;
  const rawQuorum = search.get("quorum");
  const rawMin = search.get("min");

  const state = await loadGroupState(chat, {
    quorum: rawQuorum && /^\d+$/.test(rawQuorum) ? Number(rawQuorum) : null,
    minSlot: rawMin && /^\d+$/.test(rawMin) ? Number(rawMin) : null,
    withMeetings: false,
  });

  return Response.json(toBoardPayload(state, chat.lang));
}
