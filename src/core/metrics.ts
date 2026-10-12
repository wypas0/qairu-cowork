/**
 * Метрики качества сервиса — чистая часть: ключи часовых корзин, гистограмма
 * с фиксированными границами и оценка p50/p95 по ней.
 *
 * Хранится только сводка: в корзине `metric:<имя>:<YYYY-MM-DDTHH>` (час по
 * UTC) лежат плоские счётчики — `n` (сколько замеров), `sum` (их сумма),
 * `b0`…`b8` (сколько замеров попало в каждую ячейку гистограммы), счётчики
 * сбоев (`err`, `late`, `forbidden`…) и у cron — `at`, моменты прогонов. Ни id
 * людей, ни текстов, ни адресов: консоль обещает «без трекеров».
 *
 * Модуль не знает ни про БД, ни про Next: его проверяют юнит-тесты, а
 * пользуются им запись (lib/metrics), запрос (queries/metrics) и консоль.
 */

/** Границы ячеек времени ответа, мс. Девятая ячейка — всё, что дольше 6,4 с. */
export const LATENCY_BOUNDS_MS = [50, 100, 200, 400, 800, 1600, 3200, 6400] as const;
/** Границы ячеек задержки напоминаний, секунды: от 30 с до часа и дольше. */
export const DELAY_BOUNDS_S = [30, 60, 120, 300, 600, 900, 1800, 3600] as const;
export type Bounds = readonly number[];

/** Маршруты сайта и бота, у которых меряется время ответа. Набор маленький и именованный. */
export const ROUTE_METRICS = ["webhook", "board", "state", "schedule"] as const;
export type RouteMetric = (typeof ROUTE_METRICS)[number];

/**
 * Все корзины: маршруты, вызовы Bot API (`tg`), напоминания (`reminder`),
 * прогоны cron (`cron`) и необработанные ошибки сервера (`errors`).
 */
export type MetricName = RouteMetric | "tg" | "reminder" | "cron" | "errors";

/** Классы сбоев вызова Telegram. */
export const TG_FAILURES = ["forbidden", "rate", "network", "other"] as const;
export type TgFailure = (typeof TG_FAILURES)[number];

/** Приращение корзины: числа складываются, массивы (моменты прогонов cron) дописываются. */
export type MetricDelta = Record<string, number | number[]>;
/** Сводка корзин за окно: только числа. */
export type MetricCounters = Record<string, number>;

export const METRIC_PREFIX = "metric:";
/** Сколько дней живут корзины: неделя для сравнения плюс день запаса. */
export const METRIC_KEEP_DAYS = 8;
/** Напоминание позже этого — «опоздало». */
export const REMINDER_LATE_S = 300;

/** «2026-10-11T07» — час по UTC: строки сравниваются так же, как моменты. */
export function metricHour(at: number): string {
  return new Date(at).toISOString().slice(0, 13);
}

export function metricKey(name: MetricName, at: number): string {
  return `${METRIC_PREFIX}${name}:${metricHour(at)}`;
}

/** Номер ячейки: первая граница не меньше значения, иначе — последняя, «дольше всех». */
export function bucketOf(value: number, bounds: Bounds): number {
  const index = bounds.findIndex((bound) => value <= bound);
  return index === -1 ? bounds.length : index;
}

/** Один замер: n, сумма и единица в своей ячейке гистограммы. */
export function sampleDelta(value: number, bounds: Bounds, extra: MetricDelta = {}): MetricDelta {
  const clean = Math.max(0, Math.round(value));
  return { n: 1, sum: clean, [`b${bucketOf(clean, bounds)}`]: 1, ...extra };
}

/**
 * Оценка квантиля `q` (0.5 — медиана, 0.95 — p95) по гистограмме: находим
 * ячейку, где лежит q·n-й замер, и линейно интерполируем внутри неё (первая
 * ячейка — от нуля). Попал в последнюю, бесконечную ячейку — `Infinity`:
 * консоль пишет «больше 6,4 с». Замеров нет — null.
 */
export function percentile(counters: MetricCounters | undefined, q: number, bounds: Bounds): number | null {
  const counts = Array.from({ length: bounds.length + 1 }, (_, i) => Math.max(0, counters?.[`b${i}`] ?? 0));
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total <= 0) return null;
  const rank = Math.min(1, Math.max(0, q)) * total;
  let seen = 0;
  for (const [index, count] of counts.entries()) {
    if (count <= 0) continue;
    if (seen + count >= rank) {
      if (index === bounds.length) return Infinity;
      const lower = index === 0 ? 0 : bounds[index - 1]!;
      return lower + ((bounds[index]! - lower) * Math.max(0, rank - seen)) / count;
    }
    seen += count;
  }
  return Infinity;
}

/**
 * Насколько напоминание опоздало, секунды. Срок — за `reminderMin` до начала,
 * но не раньше создания встречи: встреча, назначенная за 10 минут до начала
 * при пороге 30 минут, «опоздавшей» не считается — раньше напомнить было нельзя.
 */
export function reminderDelayS(start: Date, reminderMin: number, createdAt: Date | null, sentAt: Date): number {
  const due = Math.max(start.getTime() - reminderMin * 60_000, createdAt?.getTime() ?? -Infinity);
  return Math.max(0, (sentAt.getTime() - due) / 1000);
}

/** Класс сбоя по коду ответа Telegram; 0 — ответа не было (таймаут, сеть). */
export function tgFailureOf(code: number, description = ""): TgFailure | null {
  // «Сообщение не изменилось» — не сбой: так Telegram отвечает на повторную правку.
  if (code === 400 && /message is not modified/i.test(description)) return null;
  if (code === 0) return "network";
  if (code === 403) return "forbidden";
  if (code === 429) return "rate";
  return "other";
}
