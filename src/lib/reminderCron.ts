/**
 * Один прогон cron напоминаний — работа, которую `/api/cron/reminders`
 * выполняет уже после ответа вызвавшему (`after()`).
 *
 * Порядок — по срочности:
 *   1. напоминания о встречах (опоздавшее напоминание бесполезно);
 *   2. вопрос «был ли ты» после закончившихся встреч;
 *   3. личные календари — на остаток бюджета;
 *   4. уборка: протухшие сессии и часовые корзины метрик старше 8 дней.
 *
 * Бюджет общий на весь прогон и считается от прихода запроса. Прогоны могут
 * идти одновременно (внешний пингер, GitHub Actions, cron Vercel): каждая
 * единица работы забирается атомарной отметкой, дублей нет, а работа делится
 * между прогонами.
 */

import "server-only";

import { askAttendance } from "@/bot/handlers/attendance";
import { type ReminderTally, sendDueReminders } from "@/bot/handlers/meeting";
import * as repo from "@/db/repo";
import { type Budget, timeBudget } from "./budget";
import { syncStaleCalendars } from "./calendarSync";
import { hasBot } from "./config";
import { pingHeartbeat } from "./heartbeat";
import { flushMetrics, observeCronRun } from "./metrics";

/** `maxDuration` маршрута (максимум Vercel Hobby). Держать в согласии с route.ts. */
export const CRON_MAX_DURATION_S = 300;
/** Бюджет прогона: новую работу после него не берём. */
export const CRON_BUDGET_MS = 250_000;
/**
 * Запас, чтобы довести начатую рассылку одной встречи. Бюджет + запас = 280 с,
 * ещё 20 с на запись итога и сетевые хвосты до обрыва на 300 с.
 */
export const CRON_GRACE_MS = 30_000;

export type CronResult = {
  ok: boolean;
  due: number;
  sent: number;
  deferred: number;
  attendance: number;
  calendars: number;
  sessions: number;
  ms: number;
  /** Упёрся ли прогон в бюджет: что-то отложено или новую работу брать уже нельзя. */
  budgetHit: boolean;
  error?: string;
};

export async function runReminderCron(startedAt = Date.now(), budget?: Budget): Promise<CronResult> {
  const time = budget ?? timeBudget(CRON_BUDGET_MS, CRON_GRACE_MS, Date.now, startedAt);
  const result: CronResult = {
    ok: true, due: 0, sent: 0, deferred: 0, attendance: 0, calendars: 0, sessions: 0, ms: 0, budgetHit: false,
  };
  try {
    if (hasBot()) {
      const tally: ReminderTally = { due: 0 };
      result.sent = await sendDueReminders(new Date(), tally, time);
      result.due = tally.due;
      result.deferred = tally.deferred ?? 0;
      result.attendance = await askAttendance(new Date(), time);
    }
    result.calendars = await syncStaleCalendars(time);
    // Сессии, которые уже не пускают (30 дней без заходов), в базе не нужны.
    result.sessions = await repo.deleteIdleWebSessions();
    // Корзины метрик качества живут неделю с запасом — дальше консоли не нужны.
    await repo.deleteOldMetrics();
    // Друзья: просроченные приглашения гаснут (не держат место для нового),
    // ответы старше месяца и счётчики лимитов старше двух суток не нужны.
    const now = Date.now();
    await repo.expireGroupInvites(new Date(now));
    await repo.pruneFriendHistory(new Date(now - 30 * 86_400_000));
    await repo.deleteStaleBotState("fr:", new Date(now - 2 * 86_400_000));
  } catch (error) {
    // Ответ вызвавшему уже ушёл: падение видно только в журнале и в консоли владельца.
    result.ok = false;
    result.error = error instanceof Error ? error.message.split("\n")[0]!.slice(0, 200) : String(error);
  }
  result.ms = Date.now() - startedAt;
  result.budgetHit = result.deferred > 0 || !time.canStart();

  // Отметка для консоли владельца: когда был прогон, удачно ли и сколько напоминаний дошло.
  // Её сбой не должен ронять прогон, рассылка уже прошла.
  await repo
    .recordCronRun({
      at: Date.now(),
      ok: result.ok,
      due: result.due,
      sent: result.sent,
      attendance: result.attendance,
      calendars: result.calendars,
      sessions: result.sessions,
    })
    .catch(() => {});
  // «Качество» в консоли: момент прогона (для перерывов между ними), бюджет, ошибка.
  // Прогон и так идёт после ответа — записываем сразу, вместе с замерами рассылки.
  observeCronRun({ startedAt, ms: result.ms, ok: result.ok, budgetHit: result.budgetHit });
  await flushMetrics();
  // Журнал Vercel: итог прогона одной строкой (без данных людей).
  console.log(`[qairu:cron] ${JSON.stringify(result)}`);
  // Пульс для healthchecks.io (DEPLOY.md, «Мониторинг»): не задан — ничего, сбой проглатывается.
  await pingHeartbeat(result.ok);
  return result;
}
