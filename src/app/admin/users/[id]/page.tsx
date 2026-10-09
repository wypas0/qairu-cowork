import Link from "next/link";
import { notFound } from "next/navigation";

import { IconChevronLeft, IconLock } from "@/components/icons";
import { type Fmt, type T, originName } from "@/components/owner/format";
import { OwnerAvatar } from "@/components/owner/OwnerList";
import { ownerPage } from "@/components/owner/OwnerPage";
import * as repo from "@/db/repo";
import { displayName } from "@/db/schema";
import { logOwnerView } from "@/lib/ownerConsole";
import { clientInfo, ownerMetadata } from "@/lib/ownerGate";
import { parseEntityId } from "@/lib/ownerQuery";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return ownerMetadata();
}

type Tile = { title: string; rows: [string, React.ReactNode][] };

/**
 * Карточка человека в консоли: профиль, группы, расписание, встречи, сайт и
 * бот. Одним запросом. Секретов нет: ни токенов и хешей сессий, ни ссылки
 * календаря, ни логина с паролем, ни текстов встреч. Каждый просмотр — запись
 * user_view в журнал консоли.
 */
export default ownerPage(
  "users",
  async ({ access, t, fmt, params, now }) => {
    const userId = parseEntityId(params.id ?? "");
    if (userId === null) notFound();
    const detail = await repo.ownerUserDetail(userId, now, fmt.timeZone);
    if (!detail) notFound();
    await logOwnerView(access.user.userId, "user_view", userId, await clientInfo());
    return <UserCard t={t} fmt={fmt} detail={detail} />;
  },
  (params) => `/admin/users/${parseEntityId(params.id ?? "") ?? ""}`,
);

function UserCard({ t, fmt, detail }: { t: T; fmt: Fmt; detail: repo.OwnerUserDetail }) {
  const { user, groups, schedule, meetings, sessions, notices } = detail;
  const name = displayName(user);
  const yesNo = (value: boolean) => t(value ? "w_owner_yes" : "w_owner_no");

  const tiles: Tile[] = [
    {
      title: t("w_owner_profile"),
      rows: [
        [t(user.isWeb ? "w_owner_site_id" : "w_owner_tg_id"), <span className="tnum" key="id">{user.userId}</span>],
        [t("w_owner_real_name"), user.realName ?? "—"],
        [t("w_owner_tg_name"), user.fullName || "—"],
        [t("w_owner_username"), user.username ? `@${user.username}` : "—"],
        [t("w_owner_col_via"), t(user.isWeb ? "w_owner_via_web" : "w_owner_via_tg")],
        [t("w_owner_lang"), user.lang],
        [t("w_owner_registered"), fmt.dateTime(user.createdAt)],
        [t("w_owner_last_active"), fmt.dateTime(user.lastActive)],
        [t("w_owner_password"), yesNo(user.hasPassword)],
      ],
    },
    {
      title: t("w_stats_schedule"),
      rows: [
        [t("w_owner_sched_state"), user.filled ? t("w_owner_yes") : t("w_owner_sched_none")],
        [t("w_owner_sched_origin"), user.filled ? originName(t, user.origin) : "—"],
        [t("w_owner_sched_ext"), user.extVersion ?? "—"],
        [t("w_owner_sched_updated"), user.scheduleAt ? fmt.dateTime(user.scheduleAt) : "—"],
        [t("w_owner_slots_weekly"), fmt.n(schedule.weekly)],
        [t("w_owner_slots_soft"), fmt.n(schedule.soft)],
        [t("w_owner_slots_dated"), fmt.n(schedule.dated)],
        [t("w_owner_slots_periods"), fmt.n(schedule.periods)],
        [t("w_owner_slots_ics"), fmt.n(schedule.fromCalendar)],
        [
          t("w_owner_calendar"),
          user.calendar.connected
            ? user.calendar.error
              ? t("w_owner_cal_err", { code: user.calendar.error })
              : t("w_owner_cal_on", { date: user.calendar.syncedAt ? fmt.dateTime(user.calendar.syncedAt) : "—" })
            : t("w_owner_cal_off"),
        ],
      ],
    },
    {
      title: t("w_stats_meetings"),
      rows: [
        [t("w_owner_meet_made"), fmt.n(meetings.made)],
        [t("w_owner_meet_upcoming"), fmt.n(meetings.madeUpcoming)],
        [t("w_owner_meet_recurring"), fmt.n(meetings.madeRecurring)],
        [t("w_owner_meet_last"), meetings.lastMadeAt ? fmt.dateTime(meetings.lastMadeAt) : "—"],
        [t("w_owner_meet_invited"), fmt.n(meetings.invited)],
        [t("w_owner_ans_yes"), fmt.n(meetings.answers.yes)],
        [t("w_owner_ans_change"), fmt.n(meetings.answers.change)],
        [t("w_owner_ans_no"), fmt.n(meetings.answers.no)],
        [t("w_owner_meet_last_answer"), meetings.lastAnswerAt ? fmt.dateTime(meetings.lastAnswerAt) : "—"],
        [
          t("w_stats_attended"),
          `${fmt.n(meetings.attended)} / ${fmt.n(meetings.asked)} · ${fmt.percent(meetings.attended, meetings.asked)}`,
        ],
      ],
    },
    {
      title: t("w_owner_access"),
      rows: [
        [t("w_owner_sessions"), fmt.n(sessions.count)],
        [t("w_owner_last_seen"), sessions.lastSeenAt ? fmt.dateTime(sessions.lastSeenAt) : "—"],
        [t("w_owner_first_session"), sessions.firstAt ? fmt.dateTime(sessions.firstAt) : "—"],
        [t("w_owner_notices"), fmt.n(notices.total)],
        [t("w_owner_notices_unread"), fmt.n(notices.unread)],
        [t("w_owner_notice_last"), notices.lastAt ? fmt.dateTime(notices.lastAt) : "—"],
        [t("w_owner_bot_last"), t("w_owner_not_stored")],
      ],
    },
  ];

  return (
    <>
      <p className="owner-back">
        <Link href="/admin/users" prefetch={false} className="btn btn-sm btn-quiet">
          <IconChevronLeft size={16} /> {t("w_owner_back_users")}
        </Link>
      </p>
      <section className="card owner-hero" aria-labelledby="owner-user-title">
        <OwnerAvatar userId={user.userId} name={name} avatarAt={user.avatarAt} />
        <div>
          <h2 id="owner-user-title">{name}</h2>
          <p className="small muted">
            {[user.realName ? user.fullName : null, user.username ? `@${user.username}` : null].filter(Boolean).join(" · ") ||
              t(user.isWeb ? "w_owner_via_web" : "w_owner_via_tg")}
          </p>
        </div>
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
          </section>
        ))}

        <section className="card stats-tile owner-wide" aria-labelledby="owner-user-groups">
          <h2 id="owner-user-groups">{t("w_stats_groups")}</h2>
          {groups.length === 0 ? (
            <p className="small muted">{t("w_owner_no_groups")}</p>
          ) : (
            <div className="owner-table-wrap">
              <table className="owner-table owner-rows">
                <thead>
                  <tr>
                    <th scope="col">{t("w_owner_col_group")}</th>
                    <th scope="col">{t("w_owner_col_role")}</th>
                    <th scope="col">{t("w_owner_col_size")}</th>
                    <th scope="col">{t("w_owner_col_filled")}</th>
                    <th scope="col">{t("w_owner_col_origin")}</th>
                    <th scope="col">{t("w_owner_col_since")}</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((group) => (
                    <tr key={group.chatId}>
                      <th scope="row">
                        <Link href={`/admin/groups/${group.chatId}`} prefetch={false}>
                          {group.title || group.slug || group.chatId}
                        </Link>
                      </th>
                      <td data-label={t("w_owner_col_role")}>
                        {t(group.role === "admin" ? "w_owner_role_admin" : "w_owner_role_member")}
                      </td>
                      <td data-label={t("w_owner_col_size")} className="tnum">
                        {fmt.n(group.size)}
                      </td>
                      <td data-label={t("w_owner_col_filled")} className="tnum">
                        {fmt.n(group.filled)} · {fmt.percent(group.filled, group.size)}
                      </td>
                      <td data-label={t("w_owner_col_origin")}>{t(group.origin === "web" ? "w_owner_via_web" : "w_owner_via_tg")}</td>
                      <td data-label={t("w_owner_col_since")} className="tnum">
                        {fmt.date(group.joinedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <p className="small muted owner-privacy">
        <IconLock size={14} /> {t("w_owner_privacy")}
      </p>
    </>
  );
}
