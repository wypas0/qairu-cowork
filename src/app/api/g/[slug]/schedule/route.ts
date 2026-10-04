import { type NextRequest, after } from "next/server";

import { cleanIncomingSlots } from "@/core/grid";
import * as repo from "@/db/repo";
import { currentTelegramUser } from "@/lib/auth";
import { checkConflictsQuietly } from "@/lib/conflicts";

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

  let payload: { slots?: unknown; origin?: unknown; ext?: unknown };
  try {
    payload = (await request.json()) as { slots?: unknown; origin?: unknown; ext?: unknown };
  } catch {
    return Response.json({ detail: "bad request" }, { status: 400 });
  }

  const cleaned = cleanIncomingSlots(payload.slots);
  // Редактор присылает всю неделю целиком, включая «неудобно».
  await repo.replaceWeeklySlots(user.userId, [0, 1, 2, 3, 4, 5, 6], cleaned, "web", undefined, { withSoft: true });
  // Первое сохранение после импорта говорит, откуда пары: кампус или фото.
  // Ручные правки потом источник не меняют — расписание всё равно «из кампуса».
  if (payload.origin === "campus" || payload.origin === "photo") {
    const ext = typeof payload.ext === "string" && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(payload.ext) ? payload.ext : null;
    await repo.setScheduleOrigin(user.userId, payload.origin, ext);
  }
  // Не легла ли теперь чья-то встреча на занятое время — уже после ответа браузеру.
  after(() => checkConflictsQuietly(user.userId));
  return Response.json({ ok: true, saved: cleaned.length });
}
