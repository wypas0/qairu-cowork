import crypto from "node:crypto";

import { after } from "next/server";

import { cronSecret } from "@/lib/config";
import { runReminderCron } from "@/lib/reminderCron";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Максимум Vercel Hobby. Работа идёт в after(): Vercel держит функцию через
// waitUntil до конца работы, но не дольше maxDuration. Прогон укладывается в
// бюджет 250 с + 30 с запаса (src/lib/reminderCron.ts, CRON_MAX_DURATION_S).
export const maxDuration = 300;

/**
 * Напоминания о встречах, вопрос «был ли ты» после них и обновление
 * подключённых календарей.
 *
 * Вызывают внешний пингер (cron-job.org, раз в 5 минут — основной), GitHub
 * Actions (`reminders.yml`, дубль, GitHub запускает его нерегулярно) и cron
 * Vercel (`vercel.json`, раз в сутки). Все подписывают запрос заголовком
 * `Authorization: Bearer $CRON_SECRET`. Без секрета адрес не работает вовсе —
 * иначе рассылку мог бы запустить кто угодно. Секрет в адресе (`?secret=`) не
 * принимается: адреса запросов оседают в логах.
 *
 * Отвечает сразу — 202 «принято», а работу делает после ответа (`after()`):
 * у пингеров таймаут 30 с, а тяжёлый прогон длится минуты. Итог прогона —
 * в журнале Vercel (`[qairu:cron]`) и в консоли владельца. Одновременные
 * прогоны безопасны: каждое напоминание и вопрос забираются атомарно.
 */
export async function GET(request: Request) {
  const startedAt = Date.now();
  const secret = cronSecret();
  if (!secret) {
    return Response.json({ ok: false, detail: "CRON_SECRET не задан" }, { status: 503 });
  }
  if (!sameSecret(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return Response.json({ ok: false, detail: "forbidden" }, { status: 401 });
  }

  after(() => runReminderCron(startedAt).then(() => undefined));
  return Response.json({ ok: true, accepted: true }, { status: 202 });
}

/** Сравнение без утечки по времени ответа: сравниваются хеши одинаковой длины. */
function sameSecret(given: string, expected: string): boolean {
  const digest = (value: string) => crypto.createHash("sha256").update(value).digest();
  return crypto.timingSafeEqual(digest(given), digest(expected));
}
