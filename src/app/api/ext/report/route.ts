import type { NextRequest } from "next/server";

import { readExtensionReport } from "@/core/extensionImport";
import * as repo from "@/db/repo";
import { reportExtensionProblem } from "@/lib/alerts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Сколько отчётов в час на всех: поломка кампуса одна, а студентов много. */
const HOURLY_LIMIT = 3;

/**
 * Отчёт расширения кампуса о поломке → сообщение бота в ALERT_CHAT_ID.
 * Без входа: расширение шлёт его из фона, куки сайта у него нет. Поэтому
 * строгая проверка тела и общий лимит, а не лимит на человека.
 */
export async function POST(request: NextRequest) {
  if (Number(request.headers.get("content-length") ?? "0") > 2048) {
    return Response.json({ ok: false }, { status: 413 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  const report = readExtensionReport(body);
  if (!report) return Response.json({ ok: false }, { status: 400 });

  if ((await repo.bumpCounter("extreport", 60 * 60 * 1000)) > HOURLY_LIMIT) {
    return Response.json({ ok: true, sent: false });
  }
  const sent = await reportExtensionProblem(report);
  return Response.json({ ok: true, sent });
}
