import Link from "next/link";

import { IconAlert } from "@/components/icons";
import { DailyBars, ShareRow } from "@/components/OwnerCharts";
import { DB_LIMIT_BYTES, type Fmt, type T, bytes, originName } from "@/components/owner/format";
import { ownerPage } from "@/components/owner/OwnerPage";
import * as repo from "@/db/repo";
import { ownerMetadata } from "@/lib/ownerGate";

// Страница каждый раз своя: ни статической сборки, ни кэша. Next сам ставит
// динамической странице Cache-Control: no-store.
export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return ownerMetadata();
}

/**
 * Консоль владельца, «Обзор»: сводка, регистрации, воронка, удержание,
 * языки, рост и активность групп, функции, охват бота. Только агрегаты; два
 * запроса к базе параллельно (siteStats и ownerInsights), без записи на
 * просмотр. Бот, cron, хранилище и журнал — на вкладке «Система».
 */
export default ownerPage("overview", async ({ t, fmt, now }) => {
  const [stats, insights] = await Promise.all([repo.siteStats(now, fmt.timeZone), repo.ownerInsights(now, fmt.timeZone)]);
  return <Overview t={t} fmt={fmt} now={now} stats={stats} insights={insights} />;
});

function Overview({
  t,
  fmt,
  now,
  stats,
  insights,
}: {
  t: T;
  fmt: Fmt;
  now: Date;
  stats: repo.SiteStats;
  insights: repo.Insights;
}) {
  const { users, groups, schedule, meetings, db } = stats;
  const series = repo.dailySeries(users.signups, repo.SIGNUP_DAYS, now, fmt.timeZone);
  const signupsTotal = series.reduce((sum, point) => sum + point.count, 0);
  const signupsMax = Math.max(0, ...series.map((point) => point.count));
  const groupSeries = repo.dailySeries(insights.groupsByDay, repo.GROUP_DAYS, now, fmt.timeZone);
  const groupsTotal = groupSeries.reduce((sum, point) => sum + point.count, 0);
  const groupsMax = Math.max(0, ...groupSeries.map((point) => point.count));
  const dbShare = db.bytes / DB_LIMIT_BYTES;
  const limit = bytes(t, DB_LIMIT_BYTES);

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

  const { funnel, features, bot } = insights;
  const steps: [string, number, number][] = [
    ["w_owner_funnel_registered", funnel.registered, funnel.registered],
    ["w_owner_funnel_joined", funnel.joined, funnel.registered],
    ["w_owner_funnel_filled", funnel.filled, funnel.joined],
    ["w_owner_funnel_engaged", funnel.engaged, funnel.filled],
  ];
  const featureRows: [string, number][] = [
    ["w_owner_feat_photo", features.photo],
    ["w_owner_feat_campus", features.campus],
    ["w_owner_feat_calendar", features.calendar],
    ["w_owner_feat_avatars", features.avatars],
    ["w_owner_feat_passwords", features.passwords],
    ["w_owner_feat_soft", features.soft],
    ["w_owner_feat_attendance", features.attendance],
  ];
  const langName = (lang: string) => (["ru", "kk", "en"].includes(lang) ? t(`w_owner_lang_${lang}`) : lang);

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
      title: t("w_owner_funnel"),
      rows: [],
      extra: steps.map(([label, n, previous], index) => (
        <ShareRow
          key={label}
          label={t(label)}
          value={
            index === 0
              ? fmt.n(n)
              : t("w_owner_funnel_value", {
                  n: fmt.n(n),
                  total: fmt.percent(n, funnel.registered),
                  step: fmt.percent(n, previous),
                })
          }
          share={funnel.registered > 0 ? n / funnel.registered : 0}
        />
      )),
      hint: t("w_owner_funnel_hint"),
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
          label={originName(t, origin)}
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
      title: t("w_owner_langs"),
      rows: [],
      extra: insights.langs.map(({ lang, count }) => (
        <ShareRow
          key={lang}
          label={langName(lang)}
          value={`${fmt.n(count)} · ${fmt.percent(count, users.total)}`}
          share={users.total > 0 ? count / users.total : 0}
        />
      )),
    },
    {
      title: t("w_owner_features"),
      rows: [],
      extra: [
        ...featureRows.map(([label, n]) => (
          <ShareRow
            key={label}
            label={t(label)}
            value={`${fmt.n(n)} · ${fmt.percent(n, features.users)}`}
            share={features.users > 0 ? n / features.users : 0}
          />
        )),
        <ShareRow
          key="recurring"
          label={t("w_owner_feat_recurring")}
          value={t("w_owner_feat_meetings_value", {
            n: fmt.n(features.recurringMeetings),
            total: fmt.n(features.meetings),
            authors: fmt.n(features.recurringAuthors),
          })}
          share={features.meetings > 0 ? features.recurringMeetings / features.meetings : 0}
        />,
        <ShareRow
          key="summaries"
          label={t("w_owner_feat_summaries")}
          value={`${fmt.n(features.summaries)} · ${fmt.percent(features.summaries, features.meetings)}`}
          share={features.meetings > 0 ? features.summaries / features.meetings : 0}
        />,
      ],
      hint: t("w_owner_features_hint"),
    },
    {
      title: t("w_owner_reach"),
      rows: [
        [t("w_owner_reach_tg"), fmt.n(bot.telegram)],
        [t("w_owner_reach_web"), fmt.n(bot.web)],
        [t("w_owner_reach_unreachable"), `${fmt.n(bot.unreachable)} · ${fmt.percent(bot.unreachable, bot.telegram)}`],
      ],
      hint: t("w_owner_reach_hint"),
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
            {tile.rows.length > 0 && (
              <dl>
                {tile.rows.map(([label, value]) => (
                  <div key={label}>
                    <dt className="small muted">{label}</dt>
                    <dd className="tnum">{value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {tile.extra && <div className="owner-shares">{tile.extra}</div>}
            {tile.hint && <p className="small muted owner-hint">{tile.hint}</p>}
          </section>
        ))}

        <Cohorts t={t} fmt={fmt} now={now} cohorts={insights.cohorts} />

        <section className="card stats-tile owner-wide" aria-labelledby="owner-groups-growth-title">
          <div className="card-head">
            <h2 id="owner-groups-growth-title">{t("w_owner_groups_growth")}</h2>
            <p className="small muted tnum">
              {t("w_owner_groups_growth_lead", { days: repo.GROUP_DAYS, total: fmt.n(groupsTotal), max: fmt.n(groupsMax) })}
            </p>
          </div>
          <DailyBars
            points={groupSeries}
            formatDay={fmt.day}
            label={t("w_owner_groups_chart_aria", { days: repo.GROUP_DAYS, total: groupsTotal })}
          />
        </section>

        <section className="card stats-tile owner-wide" aria-labelledby="owner-top-title">
          <h2 id="owner-top-title">{t("w_owner_top_groups")}</h2>
          {insights.topGroups.length === 0 ? (
            <p className="small muted">{t("w_owner_top_none")}</p>
          ) : (
            <div className="owner-table-wrap">
              <table className="owner-table">
                <thead>
                  <tr>
                    <th scope="col">{t("w_owner_col_group")}</th>
                    <th scope="col">{t("w_owner_col_active_members")}</th>
                    <th scope="col">{t("w_owner_col_meetings30")}</th>
                    <th scope="col">{t("w_owner_col_responses30")}</th>
                  </tr>
                </thead>
                <tbody>
                  {insights.topGroups.map((group) => (
                    <tr key={group.chatId}>
                      <td>
                        <Link href={`/admin/groups/${group.chatId}`} prefetch={false}>
                          {group.title || group.slug || group.chatId}
                        </Link>
                      </td>
                      <td className="tnum">
                        {fmt.n(group.activeMembers)} / {fmt.n(group.size)}
                      </td>
                      <td className="tnum">{fmt.n(group.meetings)}</td>
                      <td className="tnum">{fmt.n(group.responses)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

/**
 * Удержание по недельным когортам. Клетка — доля когорты с любым действием на
 * k-й неделе после регистрации; цвет — та же величина (одна шкала --accent),
 * число всегда написано. Недели, до которых когорта ещё не дожила, пустые.
 */
function Cohorts({ t, fmt, now, cohorts }: { t: T; fmt: Fmt; now: Date; cohorts: repo.Cohort[] }) {
  const weeks = Array.from({ length: repo.COHORT_WEEKS - 1 }, (_, index) => index + 1);
  return (
    <section className="card stats-tile owner-wide" aria-labelledby="owner-cohorts-title">
      <h2 id="owner-cohorts-title">{t("w_owner_cohorts")}</h2>
      <p className="small muted">{t("w_owner_cohorts_lead")}</p>
      {cohorts.length === 0 ? (
        <p className="small muted">{t("w_owner_cohorts_none")}</p>
      ) : (
        <div className="owner-table-wrap">
          <table className="owner-table owner-cohorts">
            <thead>
              <tr>
                <th scope="col">{t("w_owner_cohort_col")}</th>
                <th scope="col">{t("w_owner_cohort_size")}</th>
                {weeks.map((k) => (
                  <th scope="col" key={k}>
                    {t("w_owner_cohort_week", { k })}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cohorts.map((cohort) => {
                const elapsed = repo.cohortWeeksElapsed(cohort.week, now, fmt.timeZone);
                return (
                  <tr key={cohort.week}>
                    <th scope="row" className="tnum">
                      {fmt.day(cohort.week)}
                    </th>
                    <td className="tnum">{fmt.n(cohort.size)}</td>
                    {weeks.map((k) => {
                      if (k >= elapsed) return <td key={k} className="owner-cohort-empty" />;
                      const share = cohort.size > 0 ? cohort.active[k] / cohort.size : 0;
                      const level = share === 0 ? 0 : Math.min(5, Math.ceil(share * 5));
                      return (
                        <td key={k} className={`tnum owner-cohort owner-cohort-${level}`}>
                          {fmt.percent(cohort.active[k], cohort.size)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="small muted owner-hint">{t("w_owner_cohorts_hint")}</p>
    </section>
  );
}
