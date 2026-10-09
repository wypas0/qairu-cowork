import Link from "next/link";

import { getWebhookInfo, type TgWebhookInfo } from "@/bot/api";
import { IconAlert, IconCheck } from "@/components/icons";
import { Meter } from "@/components/OwnerCharts";
import { DB_LIMIT_BYTES, bytes } from "@/components/owner/format";
import { ownerPage } from "@/components/owner/OwnerPage";
import * as repo from "@/db/repo";
import { hasBot } from "@/lib/config";
import { ipTag } from "@/lib/ownerConsole";
import { ownerMetadata } from "@/lib/ownerGate";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return ownerMetadata();
}

/** Ответ Telegram о вебхуке; молчание дольше 2,5 секунды не держит страницу. */
async function webhookInfo(): Promise<TgWebhookInfo | null> {
  if (!hasBot()) return null;
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500));
  return Promise.race([getWebhookInfo().catch(() => null), timeout]);
}

/**
 * «Система»: бот и cron, деплой, хранилище (размер и строки каждой таблицы),
 * журнал входов в консоль и просмотров карточек. База и Telegram — параллельно.
 */
export default ownerPage("system", async ({ t, fmt }) => {
  const [storage, webhook, cron, events, views] = await Promise.all([
    repo.storageStats(),
    webhookInfo(),
    repo.lastCronRun(),
    repo.recentOwnerEvents(12),
    repo.recentOwnerViews(20),
  ]);
  const dbShare = storage.bytes / DB_LIMIT_BYTES;
  const limit = bytes(t, DB_LIMIT_BYTES);

  const tiles: { title: string; rows: [string, string][]; hint?: string }[] = [
    {
      title: t("w_owner_bot"),
      rows: [
        [
          t("w_owner_webhook"),
          !hasBot()
            ? t("w_owner_webhook_unset")
            : !webhook
              ? t("w_owner_webhook_unknown")
              : webhook.url
                ? t("w_owner_webhook_ok")
                : t("w_owner_webhook_unset"),
        ],
        [t("w_owner_pending"), webhook ? fmt.n(webhook.pending_update_count) : "—"],
        [
          t("w_owner_last_error"),
          webhook?.last_error_date ? fmt.dateTime(new Date(webhook.last_error_date * 1000)) : t("w_owner_no_errors"),
        ],
        [t("w_owner_cron_last"), cron ? fmt.dateTime(new Date(cron.at)) : t("w_owner_cron_never")],
        [
          t("w_owner_reminders"),
          cron ? `${fmt.n(cron.week.sent)} / ${fmt.n(cron.week.due)} · ${fmt.percent(cron.week.sent, cron.week.due)}` : "—",
        ],
      ],
      hint: webhook?.last_error_message ? webhook.last_error_message.slice(0, 160) : undefined,
    },
    {
      title: t("w_owner_deploy"),
      rows: [
        [t("w_owner_env"), process.env.VERCEL_ENV || t("w_owner_local")],
        [t("w_owner_commit"), (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7) || "—"],
        [t("w_owner_branch"), process.env.VERCEL_GIT_COMMIT_REF || "—"],
      ],
    },
  ];

  return (
    <div className="stats-grid">
      {tiles.map((tile) => (
        <section className="card stats-tile" key={tile.title}>
          <h2>{tile.title}</h2>
          <dl>
            {tile.rows.map(([label, value]) => (
              <div key={label}>
                <dt className="small muted">{label}</dt>
                <dd className="tnum">{value}</dd>
              </div>
            ))}
          </dl>
          {tile.hint && <p className="small muted owner-hint">{tile.hint}</p>}
        </section>
      ))}

      <section className="card stats-tile owner-wide" aria-labelledby="owner-storage-title">
        <h2 id="owner-storage-title">{t("w_owner_health")}</h2>
        <div className="owner-share-head">
          <span className="small muted">{t("w_owner_db_size")}</span>
          <span className="owner-value tnum">
            {bytes(t, storage.bytes)} · {fmt.percent(storage.bytes, DB_LIMIT_BYTES)}
          </span>
        </div>
        <Meter share={dbShare} label={t("w_owner_kpi_db_sub", { percent: fmt.percent(storage.bytes, DB_LIMIT_BYTES), limit })} />
        {dbShare >= 0.8 && (
          <div className="notice warn owner-notice" role="alert">
            <IconAlert size={18} />
            {t("w_owner_db_warn", { percent: fmt.percent(storage.bytes, DB_LIMIT_BYTES), limit })}
          </div>
        )}
        <div className="owner-table-wrap">
          <table className="owner-table">
            <thead>
              <tr>
                <th scope="col">{t("w_owner_table")}</th>
                <th scope="col">{t("w_owner_size")}</th>
                <th scope="col">{t("w_owner_rows")}</th>
              </tr>
            </thead>
            <tbody>
              {storage.tables.map((table) => (
                <tr key={table.name}>
                  <td>{table.name}</td>
                  <td className="tnum">{bytes(t, table.bytes)}</td>
                  <td className="tnum">{fmt.n(table.rows)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card stats-tile owner-wide" aria-labelledby="owner-logins-title">
        <h2 id="owner-logins-title">{t("w_owner_logins")}</h2>
        <p className="small muted">{t("w_owner_logins_lead")}</p>
        {events.length === 0 ? (
          <p className="small muted">{t("w_owner_logins_none")}</p>
        ) : (
          <ul className="owner-events">
            {events.map((event, index) => (
              <li key={`${event.createdAt.getTime()}-${index}`} className={event.ok ? "" : "owner-event-bad"}>
                <span className="owner-event-icon">{event.ok ? <IconCheck size={14} /> : <IconAlert size={14} />}</span>
                <span className="tnum small">{fmt.dateTime(event.createdAt)}</span>
                <span>{t(`w_owner_ev_${event.event}`)}</span>
                <span className="small muted">
                  {event.device}
                  {event.ipHash && ` · #${ipTag(event.ipHash)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card stats-tile owner-wide" aria-labelledby="owner-views-title">
        <h2 id="owner-views-title">{t("w_owner_views")}</h2>
        <p className="small muted">{t("w_owner_views_lead")}</p>
        {views.length === 0 ? (
          <p className="small muted">{t("w_owner_views_none")}</p>
        ) : (
          <ul className="owner-events owner-views">
            {views.map((view, index) => (
              <li key={`${view.createdAt.getTime()}-${index}`}>
                <span className="owner-event-icon">
                  <IconCheck size={14} />
                </span>
                <span className="tnum small">{fmt.dateTime(view.createdAt)}</span>
                <span>
                  {t(`w_owner_ev_${view.event}`)}:{" "}
                  <Link href={`/admin/${view.event === "user_view" ? "users" : "groups"}/${view.targetId}`} prefetch={false}>
                    {view.name ?? t("w_owner_deleted")}
                  </Link>
                </span>
                <span className="small muted">{view.device}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
});
