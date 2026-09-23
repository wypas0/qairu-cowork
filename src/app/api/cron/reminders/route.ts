import crypto from "node:crypto";

import { sendDueReminders } from "@/bot/handlers/meeting";
import { syncStaleCalendars } from "@/lib/calendarSync";
import { cronSecret, hasBot } from "@/lib/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Напоминания о встречах и обновление подключённых календарей.
 *
 * Вызывают по расписанию Vercel (`vercel.json`, раз в сутки) и GitHub Actions
 * (`reminders.yml`, каждые 10 минут). Оба подписывают запрос заголовком
 * `Authorization: Bearer $CRON_SECRET`. Без секрета адрес не работает вовсе —
 * иначе рассылку мог бы запустить кто угодно. Секрет в адресе (`?secret=`) не
 * принимается: адреса запросов оседают в логах.
 */
export async function GET(request: Request) {
  const secret = cronSecret();
  if (!secret) {
    return Response.json({ ok: false, detail: "CRON_SECRET не задан" }, { status: 503 });
  }
  if (!sameSecret(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return Response.json({ ok: false, detail: "forbidden" }, { status: 401 });
  }

  // Календари — до напоминаний и с запасом по времени: функция живёт 60 секунд.
  const calendars = await syncStaleCalendars(5, 30_000);

  if (!hasBot()) return Response.json({ ok: true, sent: 0, calendars, detail: "BOT_TOKEN не задан" });

  const sent = await sendDueReminders();
  return Response.json({ ok: true, sent, calendars });
}

/** Сравнение без утечки по времени ответа: сравниваются хеши одинаковой длины. */
function sameSecret(given: string, expected: string): boolean {
  const digest = (value: string) => crypto.createHash("sha256").update(value).digest();
  return crypto.timingSafeEqual(digest(given), digest(expected));
}
