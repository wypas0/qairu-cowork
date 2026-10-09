import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getWebhookInfo, type TgWebhookInfo } from "@/bot/api";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { FlashToast } from "@/components/FlashToast";
import { IconAlert, IconCheck, IconLock } from "@/components/icons";
import { DailyBars, Meter, ShareRow } from "@/components/OwnerCharts";
import { Topbar } from "@/components/Topbar";
import * as repo from "@/db/repo";
import type { User } from "@/db/schema";
import { translator } from "@/i18n";
import { defaultTz, hasBot } from "@/lib/config";
import { OWNER_CODE_MAX_ATTEMPTS, OWNER_CODE_TTL_MS, ipTag } from "@/lib/ownerConsole";
import { currentOwnerSession, ownerViewer } from "@/lib/ownerGate";
import { logoutAllOwnerAction, logoutOwnerAction, requestOwnerCodeAction, verifyOwnerCodeAction } from "./actions";

// Страница каждый раз своя: ни статической сборки, ни кэша. Next сам ставит
// динамической странице Cache-Control: no-store.
export const dynamic = "force-dynamic";

/**
 * noindex и no-referrer — только владельцу. Статичный `metadata` попадал бы
 * и в ответ «не найдено» для остальных, и тот отличался бы от обычного 404.
 */
export async function generateMetadata(): Promise<Metadata> {
  if (!(await ownerViewer())) return {};
  return { robots: { index: false, follow: false, nocache: true }, referrer: "no-referrer" };
}

/** Лимит базы на бесплатном тарифе Supabase. */
const DB_LIMIT_BYTES = 500 * 1024 * 1024;
const MB = 1024 * 1024;

const FLASH_OK: Record<string, string> = { sent: "w_owner_sent", in: "w_owner_in", out: "w_owner_out" };
const FLASH_ERR: Record<string, string> = {
  wrong: "w_owner_err_wrong",
  format: "w_owner_err_format",
  missing: "w_owner_err_missing",
  expired: "w_owner_err_expired",
  locked: "w_owner_err_locked",
  throttled: "w_owner_err_throttled",
  send_failed: "w_owner_err_send_failed",
  no_bot: "w_owner_no_bot",
};

type Query = Record<string, string | string[] | undefined>;
type T = ReturnType<typeof translator>;

const LOCALES: Record<string, string> = { ru: "ru-RU", kk: "kk-KZ", en: "en-GB" };

/**
 * Консоль владельца: агрегаты по базе, бот, хранилище, деплой, журнал входов.
 *
 * Пускает только вошедшего через Telegram владельца (lib/owner) и только после
 * кода от бота (lib/ownerConsole). Остальным — «не найдено», как будто адреса
 * нет: ни формы входа, ни «нет доступа». Без трекеров и записи на просмотр.
 */
export default async function OwnerConsolePage({ searchParams }: { searchParams: Promise<Query> }) {
  const viewer = await ownerViewer();
  if (!viewer) notFound();

  const { user } = viewer;
  const t = translator(user.lang);
  const query = await searchParams;
  const session = await currentOwnerSession(viewer);
  const fmt = formatters(user.lang);

  const okKey = query.out === "all" ? "w_owner_out_all" : FLASH_OK[Object.keys(FLASH_OK).find((key) => key in query) ?? ""];
  const errKey = typeof query.err === "string" ? FLASH_ERR[query.err] : undefined;
  const left = typeof query.left === "string" ? Number(query.left) || 0 : 0;

  return (
    <>
      <Topbar lang={user.lang} />
      <main className="wrap owner">
        <FlashToast
          message={errKey ? t(errKey, { left }) : okKey ? t(okKey) : null}
          tone={errKey ? "error" : "ok"}
          params={["sent", "in", "out", "err", "left"]}
        />
        <header className="page-head">
          <div>
            <p className="eyebrow">{t("w_owner_eyebrow")}</p>
            <h1>{t("w_owner_title")}</h1>
            <p className="lead">{t("w_owner_lead")}</p>
          </div>
          {session && (
            <div className="owner-session">
              <p className="small muted">{t("w_owner_session_until", { time: fmt.time(session.expiresAt) })}</p>
              <div className="owner-session-actions">
                <form action={logoutOwnerAction}>
                  <button className="btn btn-sm" type="submit">
                    {t("w_owner_logout")}
                  </button>
                </form>
                <form action={logoutAllOwnerAction}>
                  <ConfirmSubmit className="btn btn-sm btn-quiet btn-danger" confirm={t("w_owner_logout_all_confirm")}>
                    {t("w_owner_logout_all")}
                  </ConfirmSubmit>
                </form>
              </div>
            </div>
          )}
        </header>
        {session ? <Console t={t} fmt={fmt} /> : <Gate user={user} t={t} fmt={fmt} />}
      </main>
    </>
  );
}

function formatters(lang: string) {
  const locale = LOCALES[lang] ?? "ru-RU";
  const timeZone = defaultTz();
  const number = new Intl.NumberFormat(locale);
  const time = new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit" });
  const dateTime = new Intl.DateTimeFormat(locale, {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const day = new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "2-digit", month: "2-digit" });
  return {
    timeZone,
    n: (value: number) => number.format(value),
    time: (value: Date) => time.format(value),
    dateTime: (value: Date) => dateTime.format(value),
    /** «2026-10-09» → «09.10»: календарный день, без сдвига пояса. */
    day: (value: string) => day.format(new Date(`${value}T12:00:00Z`)),
    percent: (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—"),
  };
}
type Fmt = ReturnType<typeof formatters>;

function bytes(t: T, value: number): string {
  return value >= MB ? t("w_owner_mb", { n: (value / MB).toFixed(1) }) : t("w_owner_kb", { n: Math.max(1, Math.round(value / 1024)) });
}

/** Второй фактор: «Прислать код» или поле для кода, пока он жив. */
async function Gate({ user, t, fmt }: { user: User; t: T; fmt: Fmt }) {
  const pending = await repo.pendingOwnerCode(user.userId);
  const bot = hasBot();
  return (
    <section className="card owner-gate" aria-labelledby="owner-gate-title">
      <h2 id="owner-gate-title">
        <IconLock size={18} /> {t("w_owner_gate_title")}
      </h2>
      <p className="small muted">
        {t("w_owner_gate_lead", { minutes: OWNER_CODE_TTL_MS / 60_000, attempts: OWNER_CODE_MAX_ATTEMPTS })}
      </p>
      {!bot && (
        <div className="notice warn" role="status">
          {t("w_owner_no_bot")}
        </div>
      )}
      {pending && (
        <form action={verifyOwnerCodeAction} className="owner-code-form">
          <div className="field">
            <label htmlFor="owner-code">{t("w_owner_code_label")}</label>
            <input
              id="owner-code"
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 \-]{6,8}"
              minLength={6}
              maxLength={8}
              required
              autoFocus
              spellCheck={false}
              className="owner-code-input tnum"
            />
            <p className="small muted owner-code-until">{t("w_owner_code_until", { time: fmt.time(pending.expiresAt) })}</p>
          </div>
          <button className="btn btn-primary" type="submit">
            {t("w_owner_enter")}
          </button>
        </form>
      )}
      <form action={requestOwnerCodeAction}>
        <button className={pending ? "btn btn-sm" : "btn btn-primary"} type="submit" disabled={!bot}>
          {pending ? t("w_owner_resend") : t("w_owner_send_code")}
        </button>
      </form>
    </section>
  );
}

/** Ответ Telegram о вебхуке; молчание дольше 2,5 секунды не держит страницу. */
async function webhookInfo(): Promise<TgWebhookInfo | null> {
  if (!hasBot()) return null;
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500));
  return Promise.race([getWebhookInfo().catch(() => null), timeout]);
}

async function Console({ t, fmt }: { t: T; fmt: Fmt }) {
  const now = new Date();
  // База — одним запросом, Telegram — параллельно с ней.
  const [stats, webhook, cron, events] = await Promise.all([
    repo.siteStats(now, fmt.timeZone),
    webhookInfo(),
    repo.lastCronRun(),
    repo.recentOwnerEvents(12),
  ]);
  const { users, groups, schedule, meetings, db } = stats;

  const series = repo.dailySeries(users.signups, repo.SIGNUP_DAYS, now, fmt.timeZone);
  const signupsTotal = series.reduce((sum, point) => sum + point.count, 0);
  const signupsMax = Math.max(0, ...series.map((point) => point.count));
  const dbShare = db.bytes / DB_LIMIT_BYTES;
  const limit = bytes(t, DB_LIMIT_BYTES);
  const originName = (origin: string) =>
    origin === "campus"
      ? t("w_member_origin_campus")
      : origin === "photo"
        ? t("w_member_origin_photo")
        : t("w_member_origin_manual");

  const kpis: { label: string; value: string; sub: string; alert?: boolean }[] = [
    { label: t("w_owner_kpi_users"), value: fmt.n(users.total), sub: t("w_owner_kpi_users_sub", { n: fmt.n(users.newWeek) }) },
    {
      label: t("w_owner_kpi_active"),
      value: fmt.n(users.mau),
      sub: t("w_owner_kpi_active_sub", { dau: fmt.n(users.dau), wau: fmt.n(users.wau) }),
    },
    { label: t("w_owner_kpi_live"), value: fmt.n(groups.live), sub: t("w_owner_kpi_live_sub", { total: fmt.n(groups.total) }) },
    {
      label: t("w_owner_kpi_upcoming"),
      value: fmt.n(meetings.upcoming),
      sub: t("w_owner_kpi_upcoming_sub", { n: fmt.n(meetings.month) }),
    },
    {
      label: t("w_owner_kpi_db"),
      value: bytes(t, db.bytes),
      sub: t("w_owner_kpi_db_sub", { percent: fmt.percent(db.bytes, DB_LIMIT_BYTES), limit }),
      alert: dbShare >= 0.8,
    },
  ];

  const tiles: { title: string; rows: [string, string][]; hint?: string; extra?: React.ReactNode }[] = [
    {
      title: t("w_stats_people"),
      rows: [
        [t("w_stats_total"), fmt.n(users.total)],
        [t("w_owner_new_day"), fmt.n(users.newDay)],
        [t("w_stats_new_week"), fmt.n(users.newWeek)],
        [t("w_owner_new_month"), fmt.n(users.newMonth)],
        [t("w_owner_dau"), fmt.n(users.dau)],
        [t("w_owner_wau"), fmt.n(users.wau)],
        [t("w_owner_mau"), fmt.n(users.mau)],
      ],
      hint: t("w_owner_active_hint"),
    },
    {
      title: t("w_stats_groups"),
      rows: [
        [t("w_stats_total"), fmt.n(groups.total)],
        [t("w_owner_groups_live"), fmt.n(groups.live)],
        [t("w_stats_groups_two"), fmt.n(groups.withTwoPlus)],
        [t("w_owner_groups_avg"), groups.avgSize.toFixed(1)],
        [t("w_stats_groups_meeting"), fmt.n(groups.withMeetingMonth)],
      ],
    },
    {
      title: t("w_stats_schedule"),
      rows: [[t("w_stats_filled"), `${fmt.n(schedule.filled)} · ${fmt.percent(schedule.filled, users.total)}`]],
      extra: schedule.origins.map(({ origin, count }) => (
        <ShareRow
          key={origin}
          label={originName(origin)}
          value={`${fmt.n(count)} · ${fmt.percent(count, schedule.filled)}`}
          share={schedule.filled > 0 ? count / schedule.filled : 0}
        />
      )),
    },
    {
      title: t("w_stats_versions"),
      rows:
        schedule.versions.length > 0
          ? schedule.versions.map(({ version, count }): [string, string] => [version, fmt.n(count)])
          : [[t("w_stats_none"), "—"]],
    },
    {
      title: t("w_stats_meetings"),
      rows: [
        [t("w_stats_total"), fmt.n(meetings.total)],
        [t("w_stats_week"), fmt.n(meetings.week)],
        [t("w_stats_month"), fmt.n(meetings.month)],
        [t("w_owner_upcoming"), fmt.n(meetings.upcoming)],
        [t("w_owner_past"), fmt.n(meetings.past)],
        [t("w_owner_cancelled"), fmt.n(meetings.cancelled)],
        [t("w_owner_ans_yes"), fmt.n(meetings.answers.yes)],
        [t("w_owner_ans_change"), fmt.n(meetings.answers.change)],
        [t("w_owner_ans_no"), fmt.n(meetings.answers.no)],
        [
          t("w_stats_attended"),
          `${fmt.n(meetings.attended)} / ${fmt.n(meetings.asked)} · ${fmt.percent(meetings.attended, meetings.asked)}`,
        ],
      ],
    },
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
    <>
      <section className="owner-kpis" aria-label={t("w_owner_title")}>
        {kpis.map((kpi) => (
          <div className="card owner-kpi" key={kpi.label}>
            <p className="small muted">{kpi.label}</p>
            <p className="owner-kpi-value tnum">{kpi.value}</p>
            <p className={kpi.alert ? "small owner-kpi-sub owner-warn" : "small muted owner-kpi-sub"}>
              {kpi.alert && <IconAlert size={14} />} {kpi.sub}
            </p>
          </div>
        ))}
      </section>

      <section className="card owner-signups" aria-labelledby="owner-signups-title">
        <div className="card-head">
          <h2 id="owner-signups-title">{t("w_owner_signups")}</h2>
          <p className="small muted tnum">
            {t("w_owner_signups_lead", { days: repo.SIGNUP_DAYS, total: fmt.n(signupsTotal), max: fmt.n(signupsMax) })}
          </p>
        </div>
        <DailyBars
          points={series}
          formatDay={fmt.day}
          label={t("w_owner_chart_aria", { days: repo.SIGNUP_DAYS, total: signupsTotal })}
        />
        <details className="owner-table-toggle">
          <summary className="small">{t("w_owner_as_table")}</summary>
          <table className="owner-table">
            <thead>
              <tr>
                <th scope="col">{t("w_owner_day")}</th>
                <th scope="col">{t("w_owner_count")}</th>
              </tr>
            </thead>
            <tbody>
              {series
                .filter((point) => point.count > 0)
                .reverse()
                .map((point) => (
                  <tr key={point.day}>
                    <td className="tnum">{fmt.day(point.day)}</td>
                    <td className="tnum">{fmt.n(point.count)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </details>
      </section>

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
            {tile.extra && <div className="owner-shares">{tile.extra}</div>}
            {tile.hint && <p className="small muted owner-hint">{tile.hint}</p>}
          </section>
        ))}

        <section className="card stats-tile owner-wide" aria-labelledby="owner-storage-title">
          <h2 id="owner-storage-title">{t("w_owner_health")}</h2>
          <div className="owner-share-head">
            <span className="small muted">{t("w_owner_db_size")}</span>
            <span className="owner-value tnum">
              {bytes(t, db.bytes)} · {fmt.percent(db.bytes, DB_LIMIT_BYTES)}
            </span>
          </div>
          <Meter share={dbShare} label={t("w_owner_kpi_db_sub", { percent: fmt.percent(db.bytes, DB_LIMIT_BYTES), limit })} />
          {dbShare >= 0.8 && (
            <div className="notice warn owner-notice" role="alert">
              <IconAlert size={18} />
              {t("w_owner_db_warn", { percent: fmt.percent(db.bytes, DB_LIMIT_BYTES), limit })}
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
                {db.tables.map((table) => (
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
      </div>
    </>
  );
}
