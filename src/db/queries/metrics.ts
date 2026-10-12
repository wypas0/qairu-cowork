/**
 * Метрики качества: часовые корзины в `bot_state` (без своей таблицы — новой
 * миграции не нужно). Ключи, ячейки и квантили — в core/metrics.
 */

import "server-only";

import { sql } from "drizzle-orm";

import {
  METRIC_KEEP_DAYS,
  METRIC_PREFIX,
  type MetricCounters,
  type MetricDelta,
  metricHour,
} from "@/core/metrics";
import { type Exec, ex } from "./base";
import { list, num, rowsOf } from "./rows";

/**
 * Прибавить приращения к корзинам — одной инструкцией на всю пачку.
 *
 * Слияние идёт внутри Postgres (`on conflict do update` с jsonb-арифметикой):
 * строка корзины заблокирована на время обновления, поэтому одновременные
 * запросы с разных функций Vercel не теряют счёт — чтения-изменения-записи в
 * коде нет. Числа складываются, массивы (`at` у cron) дописываются. Ключи
 * сортируются: две пачки блокируют строки в одном порядке и не ждут друг друга.
 */
export async function bumpMetrics(rows: { key: string; data: MetricDelta }[], exec?: Exec): Promise<void> {
  if (rows.length === 0) return;
  const values = [...rows]
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((row) => sql`(${row.key}, ${JSON.stringify(row.data)}::jsonb, now())`);
  await ex(exec).execute(sql`
    insert into bot_state as s (key, data, updated_at)
    values ${sql.join(values, sql`, `)}
    on conflict (key) do update set
      data = (
        select coalesce(jsonb_object_agg(f.k, case
                 when jsonb_typeof(coalesce(s.data -> f.k, excluded.data -> f.k)) = 'array'
                   then coalesce(s.data -> f.k, '[]'::jsonb) || coalesce(excluded.data -> f.k, '[]'::jsonb)
                 else to_jsonb(coalesce((s.data ->> f.k)::numeric, 0) + coalesce((excluded.data ->> f.k)::numeric, 0))
               end), '{}'::jsonb)
          from (select jsonb_object_keys(s.data) as k union select jsonb_object_keys(excluded.data)) as f
      ),
      updated_at = excluded.updated_at
  `);
}

/** Сводка корзин за окно: имя → счётчики. */
export type MetricWindow = Record<string, MetricCounters>;

export type QualityStats = {
  /** Последние 24 часовые корзины, включая текущую. */
  day: MetricWindow;
  /** Последние 7 × 24 корзины — для сравнения. */
  week: MetricWindow;
  cron: {
    /** Последний прогон за неделю, мс; null — прогонов не было. */
    lastAt: number | null;
    /** Самый долгий перерыв между прогонами (и от последнего до «сейчас»), секунды. */
    dayGapS: number | null;
    weekGapS: number | null;
  };
};

/**
 * Качество для вкладки «Система» — одним запросом: суммы счётчиков по именам
 * за сутки и за неделю, плюс перерывы между прогонами cron (lag по моментам
 * прогонов). Перерыв, закончившийся в окне, считается целиком, даже если начался
 * раньше; открытый перерыв от последнего прогона до «сейчас» — тоже перерыв.
 */
export async function qualityStats(now = new Date(), exec?: Exec): Promise<QualityStats> {
  const at = now.getTime();
  const dayFrom = metricHour(at - 23 * 3_600_000);
  const weekFrom = metricHour(at - (7 * 24 - 1) * 3_600_000);
  const daySince = (at - 86_400_000) / 1000;
  const weekSince = (at - 7 * 86_400_000) / 1000;
  const result = await ex(exec).execute(sql`
    with b as (
      select split_part(key, ':', 2) as name, split_part(key, ':', 3) as hour, data
        from bot_state
       where key like ${`${METRIC_PREFIX}%`} and split_part(key, ':', 3) >= ${weekFrom}
    ),
    sums as (
      select w.win, b.name, e.key as k, sum((e.value #>> '{}')::numeric)::float8 as v
        from b
        join (values ('day', ${dayFrom}::text), ('week', ${weekFrom}::text)) as w(win, since) on b.hour >= w.since
        cross join lateral jsonb_each(b.data) as e
       where jsonb_typeof(e.value) = 'number'
       group by w.win, b.name, e.key
    ),
    runs as (
      select (r.value #>> '{}')::float8 as at
        from b
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(b.data -> 'at') = 'array' then b.data -> 'at' else '[]'::jsonb end) as r
       where b.name = 'cron'
    ),
    gaps as (
      select at, at - lag(at) over (order by at) as gap from runs
    )
    select
      (select coalesce(json_agg(json_build_object('win', win, 'name', name, 'k', k, 'v', v)), '[]'::json)
         from sums) as sums,
      (select max(at) from runs where at >= ${weekSince}::float8) as last_at,
      (select max(gap) from gaps where at >= ${daySince}::float8) as day_gap,
      (select max(gap) from gaps where at >= ${weekSince}::float8) as week_gap
  `);
  const row = rowsOf(result)[0] ?? {};
  const day: MetricWindow = {};
  const week: MetricWindow = {};
  for (const item of list<{ win: string; name: string; k: string; v: unknown }>(row.sums)) {
    const into = item.win === "day" ? day : week;
    (into[item.name] ??= {})[item.k] = num(item.v);
  }
  const lastS = row.last_at === null || row.last_at === undefined ? null : num(row.last_at);
  const open = lastS === null ? null : Math.max(0, at / 1000 - lastS);
  // Открытый перерыв — от последнего прогона до сейчас: cron, который встал совсем, тоже виден.
  const gap = (closed: unknown) =>
    open === null ? null : Math.max(closed === null || closed === undefined ? 0 : num(closed), open);
  return {
    day,
    week,
    cron: {
      lastAt: lastS === null ? null : Math.round(lastS * 1000),
      dayGapS: gap(row.day_gap),
      weekGapS: gap(row.week_gap),
    },
  };
}

/** Уборка: корзины старше METRIC_KEEP_DAYS — по часу в ключе, а не по updated_at. */
export async function deleteOldMetrics(now = new Date(), exec?: Exec): Promise<number> {
  const before = metricHour(now.getTime() - METRIC_KEEP_DAYS * 86_400_000);
  const result = await ex(exec).execute(sql`
    delete from bot_state
     where key like ${`${METRIC_PREFIX}%`} and split_part(key, ':', 3) < ${before}
    returning key
  `);
  return rowsOf(result).length;
}
