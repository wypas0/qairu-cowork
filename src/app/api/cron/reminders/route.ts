import type { NextRequest } from "next/server";

import { sendDueReminders } from "@/bot/handlers/meeting";
import { cronSecret, hasBot } from "@/lib/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Напоминания о встречах.
 *
 * Vercel вызывает этот адрес по расписанию из `vercel.json` и подписывает
 * запрос заголовком `Authorization: Bearer $CRON_SECRET`. Тот же секрет
 * принимается в query-параметре — так адрес можно отдать внешнему пингеру,
 * если тарифу Vercel не хватает частоты запуска.
 */
export async function GET(request: NextRequest) {
  const secret = cronSecret();
  if (secret) {
    const header = request.headers.get("authorization") ?? "";
    const fromQuery = request.nextUrl.searchParams.get("secret") ?? "";
    if (header !== `Bearer ${secret}` && fromQuery !== secret) {
      return Response.json({ ok: false, detail: "forbidden" }, { status: 401 });
    }
  }

  if (!hasBot()) return Response.json({ ok: true, sent: 0, detail: "BOT_TOKEN не задан" });

  const sent = await sendDueReminders();
  return Response.json({ ok: true, sent });
}
