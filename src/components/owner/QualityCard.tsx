/* «Качество за 24 часа» на вкладке «Система»: время ответа маршрутов,
   задержка напоминаний, сбои Telegram, прогоны cron. Серверный компонент —
   ни строки JS в браузере. Плохое значение — цветом предупреждения со значком,
   и то же словами в плашке «Требует внимания»: не только цветом. */

import { IconAlert } from "@/components/icons";
import {
  DELAY_BOUNDS_S,
  LATENCY_BOUNDS_MS,
  type MetricCounters,
  ROUTE_METRICS,
  TG_FAILURES,
  percentile,
} from "@/core/metrics";
import type { QualityStats } from "@/db/repo";
import { type Fmt, type T, duration } from "./format";

/** p95 дольше этого — медленно. */
const SLOW_P95_MS = 2000;
/** Перерыв между прогонами cron дольше этого — основной пингер (раз в 5 минут) молчит. */
const CRON_GAP_S = 15 * 60;

const ROWS = [...ROUTE_METRICS, "tg"] as const;
const LATENCY_CAP = LATENCY_BOUNDS_MS[LATENCY_BOUNDS_MS.length - 1];
const DELAY_CAP_MS = DELAY_BOUNDS_S[DELAY_BOUNDS_S.length - 1] * 1000;

type Row = { label: string; value: string; warn?: boolean };

const count = (counters: MetricCounters | undefined, key: string) => counters?.[key] ?? 0;
/** Сбои Telegram, которые зависят от сервиса: всё, кроме 403 (человек заблокировал бота). */
const tgTrouble = (counters: MetricCounters | undefined) =>
  count(counters, "rate") + count(counters, "network") + count(counters, "other");
const tgFailures = (counters: MetricCounters | undefined) =>
  TG_FAILURES.reduce((sum, failure) => sum + count(counters, failure), 0);

function Value({ value, warn }: { value: string; warn?: boolean }) {
  if (!warn) return <>{value}</>;
  return (
    <span className="owner-q-flag">
      <IconAlert size={14} />
      {value}
    </span>
  );
}

function Rows({ title, rows, hint }: { title: string; rows: Row[]; hint?: string }) {
  return (
    <div className="owner-q-block">
      <h3>{title}</h3>
      <dl>
        {rows.map((row) => (
          <div key={row.label}>
            <dt className="small muted">{row.label}</dt>
            <dd className={row.warn ? "tnum owner-warn" : "tnum"}>
              <Value value={row.value} warn={row.warn} />
            </dd>
          </div>
        ))}
      </dl>
      {hint && <p className="small muted owner-hint">{hint}</p>}
    </div>
  );
}

export function QualityCard({ stats, t, fmt }: { stats: QualityStats; t: T; fmt: Fmt }) {
  const { day, week, cron } = stats;
  const empty = Object.keys(week).length === 0;
  const latency = (ms: number | null) => duration(t, fmt, ms, LATENCY_CAP);
  const delay = (seconds: number | null) => duration(t, fmt, seconds === null ? null : seconds * 1000, DELAY_CAP_MS);
  const problems: string[] = [];

  const routes = ROWS.map((name) => {
    const what = t(`w_owner_q_route_${name}`);
    const p95 = percentile(day[name], 0.95, LATENCY_BOUNDS_MS);
    const errors = name === "tg" ? tgTrouble(day.tg) : count(day[name], "err");
    const slow = p95 !== null && p95 > SLOW_P95_MS;
    if (slow) problems.push(t("w_owner_q_warn_slow", { what, value: latency(p95) }));
    if (errors > 0) problems.push(t("w_owner_q_warn_errors", { what, n: fmt.n(errors) }));
    return {
      name,
      what,
      n: count(day[name], "n"),
      p50: latency(percentile(day[name], 0.5, LATENCY_BOUNDS_MS)),
      p95: latency(p95),
      slow,
      errors,
      week: latency(percentile(week[name], 0.95, LATENCY_BOUNDS_MS)),
    };
  });

  const serverErrors = count(day.errors, "n");
  if (serverErrors > 0) problems.push(t("w_owner_q_warn_server", { n: fmt.n(serverErrors) }));

  const reminder = day.reminder;
  const sent = count(reminder, "n");
  const late = count(reminder, "late");
  const failed = count(reminder, "failed");
  if (late > 0) problems.push(t("w_owner_q_warn_late", { n: fmt.n(late) }));
  if (failed > 0) problems.push(t("w_owner_q_warn_failed", { n: fmt.n(failed) }));

  const trouble = tgTrouble(day.tg);
  if (trouble > 0) problems.push(t("w_owner_q_warn_tg", { n: fmt.n(trouble) }));

  const runs = count(day.cron, "n");
  const budget = count(day.cron, "budget");
  const cronErrors = count(day.cron, "err");
  const gapWarn = cron.dayGapS === null || cron.dayGapS > CRON_GAP_S;
  if (cron.dayGapS === null) problems.push(t("w_owner_q_warn_no_cron"));
  else if (gapWarn) problems.push(t("w_owner_q_warn_gap", { value: delay(cron.dayGapS) }));
  if (budget > 0) problems.push(t("w_owner_q_warn_budget", { n: fmt.n(budget) }));
  if (cronErrors > 0) problems.push(t("w_owner_q_warn_cron_err", { n: fmt.n(cronErrors) }));

  return (
    <section className="card stats-tile owner-wide owner-quality" aria-labelledby="owner-quality-title">
      <h2 id="owner-quality-title">{t("w_owner_q_title")}</h2>
      <p className="small muted">{t("w_owner_q_lead")}</p>
      {empty ? (
        <p className="small muted">{t("w_owner_q_empty")}</p>
      ) : (
        <>
          {problems.length > 0 && (
            <div className="notice warn owner-notice owner-q-problems" role="status">
              <IconAlert size={18} />
              <div>
                <p>{t("w_owner_q_attention")}</p>
                <ul>
                  {problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <h3>{t("w_owner_q_speed")}</h3>
          <div className="owner-table-wrap">
            <table className="owner-table owner-rows owner-q-table">
              <thead>
                <tr>
                  <th scope="col">{t("w_owner_q_col_what")}</th>
                  <th scope="col">{t("w_owner_q_col_count")}</th>
                  <th scope="col">p50</th>
                  <th scope="col">p95</th>
                  <th scope="col">{t("w_owner_q_col_errors")}</th>
                  <th scope="col">{t("w_owner_q_col_week")}</th>
                </tr>
              </thead>
              <tbody>
                {routes.map((route) => (
                  <tr key={route.name}>
                    <th scope="row">{route.what}</th>
                    <td className="tnum" data-label={t("w_owner_q_col_count")}>
                      {fmt.n(route.n)}
                    </td>
                    <td className="tnum" data-label="p50">
                      {route.p50}
                    </td>
                    <td className={route.slow ? "tnum owner-warn" : "tnum"} data-label="p95">
                      <Value value={route.p95} warn={route.slow} />
                    </td>
                    <td className={route.errors > 0 ? "tnum owner-warn" : "tnum"} data-label={t("w_owner_q_col_errors")}>
                      <Value value={fmt.n(route.errors)} warn={route.errors > 0} />
                    </td>
                    <td className="tnum" data-label={t("w_owner_q_col_week")}>
                      {route.week}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted owner-hint">{t("w_owner_q_tg_errors_hint")}</p>

          <div className="owner-q-grid">
            <Rows
              title={t("w_owner_q_reminders")}
              rows={[
                { label: t("w_owner_q_rem_sent"), value: fmt.n(sent) },
                { label: t("w_owner_q_rem_p50"), value: delay(percentile(reminder, 0.5, DELAY_BOUNDS_S)) },
                { label: t("w_owner_q_rem_p95"), value: delay(percentile(reminder, 0.95, DELAY_BOUNDS_S)) },
                { label: t("w_owner_q_rem_late"), value: sent > 0 ? `${fmt.n(late)} · ${fmt.percent(late, sent)}` : fmt.n(late), warn: late > 0 },
                { label: t("w_owner_q_rem_failed"), value: fmt.n(failed), warn: failed > 0 },
                { label: t("w_owner_q_rem_week"), value: delay(percentile(week.reminder, 0.95, DELAY_BOUNDS_S)) },
              ]}
            />
            <Rows
              title={t("w_owner_q_tg")}
              rows={[
                ...TG_FAILURES.map((failure) => ({
                  label: t(`w_owner_q_tg_${failure}`),
                  value: fmt.n(count(day.tg, failure)),
                  warn: failure !== "forbidden" && count(day.tg, failure) > 0,
                })),
                { label: t("w_owner_q_tg_week"), value: fmt.n(tgFailures(week.tg)) },
              ]}
              hint={t("w_owner_q_tg_hint")}
            />
            <Rows
              title={t("w_owner_q_cron")}
              rows={[
                { label: t("w_owner_q_cron_runs"), value: fmt.n(runs), warn: runs === 0 },
                {
                  label: t("w_owner_q_cron_gap"),
                  value: cron.dayGapS === null ? t("w_owner_q_cron_none") : delay(cron.dayGapS),
                  warn: gapWarn,
                },
                { label: t("w_owner_q_cron_budget"), value: fmt.n(budget), warn: budget > 0 },
                { label: t("w_owner_q_cron_errors"), value: fmt.n(cronErrors), warn: cronErrors > 0 },
                { label: t("w_owner_q_server_errors"), value: fmt.n(serverErrors), warn: serverErrors > 0 },
                {
                  label: t("w_owner_q_cron_week"),
                  value: `${fmt.n(count(week.cron, "n"))} · ${cron.weekGapS === null ? "—" : delay(cron.weekGapS)}`,
                },
              ]}
            />
          </div>
        </>
      )}
    </section>
  );
}
