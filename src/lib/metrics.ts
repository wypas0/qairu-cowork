/**
 * Запись метрик качества: время ответа маршрутов, вызовы Telegram,
 * задержка напоминаний, прогоны cron.
 *
 * Запись не должна ни замедлять, ни ронять запрос. Поэтому замер только
 * копится в памяти функции (приращения складываются по ключу корзины), а в
 * базу уходит после ответа (`after()`) — одной инструкцией на всю пачку
 * (`repo.bumpMetrics`). Сбой записи глотается и пишется в журнал: метрики —
 * не повод для ошибки у человека. Вне запроса Next (тесты, скрипты) `after()`
 * бросает исключение — тогда пачка уходит сразу, следующим микрозаданием;
 * дождаться её можно `flushMetrics()`.
 *
 * Выключить: `QAIRU_METRICS=off` — замеры не копятся и в базу не пишутся.
 */

import "server-only";

import { after } from "next/server";

import {
  DELAY_BOUNDS_S,
  LATENCY_BOUNDS_MS,
  type MetricDelta,
  type MetricName,
  REMINDER_LATE_S,
  type RouteMetric,
  type TgFailure,
  metricKey,
  sampleDelta,
} from "@/core/metrics";
import * as repo from "@/db/repo";
import { env } from "./config";

const pending = new Map<string, MetricDelta>();
const inflight = new Set<Promise<void>>();
/**
 * Когда запланирована запись. Одна запись на пачку, а не на замер; но если
 * запланированная почему-то не случилась (запрос оборвался), через 10 секунд
 * следующий замер запланирует новую — счётчики не застрянут в памяти.
 */
let scheduledAt = 0;
const RESCHEDULE_MS = 10_000;

export function metricsEnabled(): boolean {
  return env("QAIRU_METRICS") !== "off";
}

/** Прибавить приращение к корзине `name` за час момента `at`. */
export function addMetric(name: MetricName, delta: MetricDelta, at = Date.now()): void {
  if (!metricsEnabled()) return;
  const key = metricKey(name, at);
  const into = pending.get(key) ?? {};
  for (const [field, value] of Object.entries(delta)) {
    const before = into[field];
    if (Array.isArray(value)) into[field] = [...(Array.isArray(before) ? before : []), ...value];
    else into[field] = (typeof before === "number" ? before : 0) + value;
  }
  pending.set(key, into);
  schedule();
}

function schedule(): void {
  const now = Date.now();
  if (scheduledAt && now - scheduledAt < RESCHEDULE_MS) return;
  scheduledAt = now;
  try {
    after(() => flushMetrics());
  } catch {
    // Вне запроса Next: записать сразу, но после текущего синхронного кода — пачкой.
    void Promise.resolve().then(() => flushMetrics());
  }
}

/**
 * Записать накопленное и дождаться всех начатых записей. Вызывается сама после
 * ответа; cron зовёт её в конце прогона, тесты — чтобы проверить счётчики.
 */
export async function flushMetrics(): Promise<void> {
  scheduledAt = 0;
  const rows = [...pending.entries()].map(([key, data]) => ({ key, data }));
  pending.clear();
  if (rows.length > 0) {
    const write: Promise<void> = repo.bumpMetrics(rows).catch((error: unknown) => {
      // Drizzle оборачивает ошибку базы («Failed query: …» с текстом запроса) — в журнал идёт причина.
      const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
      console.warn("qairu: метрики не записаны", cause instanceof Error ? cause.message.split("\n")[0] : cause);
    });
    inflight.add(write);
    void write.finally(() => inflight.delete(write));
  }
  await Promise.all([...inflight]);
}

/** Время ответа маршрута с `started` (performance.now()) до сейчас; `failed` — ошибка 5xx или исключение. */
export function observeRoute(name: RouteMetric, started: number, failed = false): void {
  addMetric(name, sampleDelta(performance.now() - started, LATENCY_BOUNDS_MS, failed ? { err: 1 } : {}));
}

/**
 * Засечь время маршрута: вернёт функцию «готово», которая запишет замер. Для
 * серверных компонентов — страница рендерится один раз на запрос, а прямой
 * `performance.now()` в теле компонента линтер React считает нечистым.
 */
export function routeTimer(name: RouteMetric): (failed?: boolean) => void {
  const started = performance.now();
  return (failed = false) => observeRoute(name, started, failed);
}

/**
 * Обернуть route handler замером. Ответ 5xx и исключение — ошибка; 4xx — нет:
 * «не участник» и «не найдено» — ответ сервиса, а не его сбой.
 */
export function timedRoute<A extends unknown[]>(
  name: RouteMetric,
  handler: (...args: A) => Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    const started = performance.now();
    let failed = true;
    try {
      const response = await handler(...args);
      failed = response.status >= 500;
      return response;
    } finally {
      observeRoute(name, started, failed);
    }
  };
}

/** Вызов Bot API: время и класс сбоя (null — успех). */
export function observeTelegram(started: number, failure: TgFailure | null): void {
  addMetric("tg", sampleDelta(performance.now() - started, LATENCY_BOUNDS_MS, failure ? { [failure]: 1 } : {}));
}

/** Напоминание ушло через `delayS` секунд после срока. */
export function observeReminder(delayS: number): void {
  addMetric("reminder", sampleDelta(delayS, DELAY_BOUNDS_S, delayS > REMINDER_LATE_S ? { late: 1 } : {}));
}

/** Напоминание забрано, но не дошло никому: Telegram ответил ошибкой на каждую попытку. */
export function countReminderFailed(): void {
  addMetric("reminder", { failed: 1 });
}

/** Прогон cron: момент старта (для перерывов), упёрся ли в бюджет, удачен ли. */
export function observeCronRun(run: { startedAt: number; ms: number; ok: boolean; budgetHit: boolean }): void {
  addMetric(
    "cron",
    { n: 1, sum: Math.max(0, Math.round(run.ms)), budget: run.budgetHit ? 1 : 0, err: run.ok ? 0 : 1, at: [Math.round(run.startedAt / 1000)] },
    run.startedAt,
  );
}

/** Необработанная ошибка сервера (страница, route handler, серверное действие). */
export function countServerError(): void {
  addMetric("errors", { n: 1 });
}
