import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Topbar } from "@/components/Topbar";
import * as repo from "@/db/repo";
import { translator } from "@/i18n";
import { pageUser } from "@/lib/gate";
import { isOwner } from "@/lib/owner";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Статистика для владельца: сколько людей и групп, чем заполняют расписание,
 * какие версии расширения в ходу, назначают ли встречи и доходят ли на них.
 * Только счётчики по своим таблицам — без трекеров и сторонних сервисов.
 * Остальным адрес отвечает «не найдено», как будто его нет.
 */
export default async function StatsPage() {
  const user = await pageUser("/admin/stats");
  if (!user || !isOwner(user.userId)) notFound();

  const t = translator(user.lang);
  const stats = await repo.siteStats();
  const percent = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—");
  const originName = (origin: string) =>
    origin === "campus"
      ? t("w_member_origin_campus")
      : origin === "photo"
        ? t("w_member_origin_photo")
        : t("w_member_origin_manual");

  const tiles: { title: string; rows: [string, string][] }[] = [
    {
      title: t("w_stats_people"),
      rows: [
        [t("w_stats_total"), String(stats.users.total)],
        [t("w_stats_new_week"), String(stats.users.newWeek)],
        [t("w_stats_active_week"), String(stats.users.activeWeek)],
        [t("w_stats_active_month"), String(stats.users.activeMonth)],
      ],
    },
    {
      title: t("w_stats_groups"),
      rows: [
        [t("w_stats_total"), String(stats.groups.total)],
        [t("w_stats_groups_two"), String(stats.groups.withTwoPlus)],
        [t("w_stats_groups_meeting"), String(stats.groups.withMeetingMonth)],
      ],
    },
    {
      title: t("w_stats_meetings"),
      rows: [
        [t("w_stats_total"), String(stats.meetings.total)],
        [t("w_stats_week"), String(stats.meetings.week)],
        [t("w_stats_month"), String(stats.meetings.month)],
        [t("w_stats_responses"), String(stats.meetings.responses)],
        [
          t("w_stats_attended"),
          `${stats.meetings.attended} / ${stats.meetings.asked} · ${percent(stats.meetings.attended, stats.meetings.asked)}`,
        ],
      ],
    },
    {
      title: t("w_stats_schedule"),
      rows: [
        [t("w_stats_filled"), `${stats.schedule.filled} · ${percent(stats.schedule.filled, stats.users.total)}`],
        ...stats.schedule.origins.map(
          ({ origin, count }): [string, string] => [originName(origin), `${count} · ${percent(count, stats.schedule.filled)}`],
        ),
      ],
    },
    {
      title: t("w_stats_versions"),
      rows:
        stats.schedule.versions.length > 0
          ? stats.schedule.versions.map(({ version, count }): [string, string] => [version, String(count)])
          : [[t("w_stats_none"), "—"]],
    },
  ];

  return (
    <>
      <Topbar lang={user.lang} />
      <main className="wrap">
        <header className="page-head">
          <div>
            <p className="eyebrow">QairuCowork</p>
            <h1>{t("w_stats_title")}</h1>
            <p className="lead">{t("w_stats_lead")}</p>
          </div>
        </header>
        <div className="stats-grid">
          {tiles.map((tile) => (
            <section className="card stats-tile" key={tile.title}>
              <h2>{tile.title}</h2>
              <dl>
                {tile.rows.map(([label, value]) => (
                  <div key={label}>
                    <dt className="small muted">{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </main>
    </>
  );
}
