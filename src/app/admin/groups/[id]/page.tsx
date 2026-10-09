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

/**
 * Группа в консоли: сведения, встречи (только числа — без целей, мест и
 * комментариев) и участники со ссылками на их карточки. Просмотр — запись
 * group_view в журнал консоли.
 */
export default ownerPage(
  "groups",
  async ({ access, t, fmt, params, now }) => {
    const chatId = parseEntityId(params.id ?? "");
    if (chatId === null) notFound();
    const detail = await repo.ownerGroupDetail(chatId, now, fmt.timeZone);
    if (!detail) notFound();
    await logOwnerView(access.user.userId, "group_view", chatId, await clientInfo());
    return <GroupCard t={t} fmt={fmt} detail={detail} />;
  },
  (params) => `/admin/groups/${parseEntityId(params.id ?? "") ?? ""}`,
);

function GroupCard({ t, fmt, detail }: { t: T; fmt: Fmt; detail: repo.OwnerGroupDetail }) {
  const { group, members, meetings } = detail;
  const creator = group.createdBy !== null ? members.find((member) => member.userId === group.createdBy) : undefined;

  const tiles: { title: string; rows: [string, React.ReactNode][] }[] = [
    {
      title: t("w_owner_group_info"),
      rows: [
        [t("w_owner_code"), group.slug ?? "—"],
        [t("w_owner_chat_id"), <span className="tnum" key="id">{group.chatId}</span>],
        [t("w_owner_col_origin"), t(group.origin === "web" ? "w_owner_via_web" : "w_owner_via_tg")],
        [t("w_owner_created"), fmt.dateTime(group.createdAt)],
        [
          t("w_owner_created_by"),
          group.createdBy === null ? (
            "—"
          ) : (
            <Link href={`/admin/users/${group.createdBy}`} prefetch={false} key="creator">
              {creator ? displayName(creator) : group.createdBy}
            </Link>
          ),
        ],
        [t("w_owner_tz"), group.tz],
        [t("w_owner_lang"), group.lang],
        [t("w_owner_semester"), group.semesterStart ? fmt.day(group.semesterStart) : "—"],
        [t("w_owner_last_active"), fmt.dateTime(group.lastActive)],
      ],
    },
    {
      title: t("w_stats_meetings"),
      rows: [
        [t("w_stats_total"), fmt.n(group.meetings)],
        [t("w_owner_meet_month"), fmt.n(group.meetingsMonth)],
        [t("w_owner_upcoming"), fmt.n(group.upcoming)],
        [t("w_owner_past"), fmt.n(meetings.past)],
        [t("w_owner_cancelled"), fmt.n(meetings.cancelled)],
        [t("w_owner_meet_recurring"), fmt.n(meetings.recurring)],
        [t("w_owner_with_summary"), fmt.n(meetings.withSummary)],
        [t("w_owner_responses"), fmt.n(meetings.responses)],
        [
          t("w_stats_attended"),
          `${fmt.n(meetings.attended)} / ${fmt.n(meetings.asked)} · ${fmt.percent(meetings.attended, meetings.asked)}`,
        ],
      ],
    },
  ];

  return (
    <>
      <p className="owner-back">
        <Link href="/admin/groups" prefetch={false} className="btn btn-sm btn-quiet">
          <IconChevronLeft size={16} /> {t("w_owner_back_groups")}
        </Link>
      </p>
      <section className="card owner-hero" aria-labelledby="owner-group-title">
        <div>
          <h2 id="owner-group-title">{group.title || group.slug || group.chatId}</h2>
          <p className="small muted tnum">
            {t("w_owner_col_size")}: {fmt.n(group.size)} · {t("w_owner_col_filled")}: {fmt.n(group.filled)} ·{" "}
            {fmt.percent(group.filled, group.size)}
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

        <section className="card stats-tile owner-wide" aria-labelledby="owner-group-members">
          <h2 id="owner-group-members">{t("w_owner_members")}</h2>
          {members.length === 0 ? (
            <p className="small muted">{t("w_owner_no_members")}</p>
          ) : (
            <div className="owner-table-wrap">
              <table className="owner-table owner-rows">
                <thead>
                  <tr>
                    <th scope="col">{t("w_owner_col_person")}</th>
                    <th scope="col">{t("w_owner_col_role")}</th>
                    <th scope="col">{t("w_owner_col_schedule")}</th>
                    <th scope="col">{t("w_owner_col_since")}</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => {
                    const name = displayName(member);
                    return (
                      <tr key={member.userId}>
                        <th scope="row">
                          <div className="owner-person-cell">
                            <OwnerAvatar userId={member.userId} name={name} avatarAt={member.avatarAt} />
                            <span className="owner-person">
                              <Link href={`/admin/users/${member.userId}`} prefetch={false} className="owner-person-name">
                                {name}
                              </Link>
                              {member.username && <span className="small muted">@{member.username}</span>}
                            </span>
                          </div>
                        </th>
                        <td data-label={t("w_owner_col_role")}>
                          {t(member.role === "admin" ? "w_owner_role_admin" : "w_owner_role_member")}
                        </td>
                        <td data-label={t("w_owner_col_schedule")}>
                          {member.filled ? (
                            <span>
                              {originName(t, member.origin)}
                              <span className="small muted tnum"> · {fmt.date(member.scheduleAt)}</span>
                            </span>
                          ) : (
                            <span className="muted">{t("w_owner_sched_none")}</span>
                          )}
                        </td>
                        <td data-label={t("w_owner_col_since")} className="tnum">
                          {fmt.date(member.joinedAt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <p className="small muted owner-privacy">
        <IconLock size={14} /> {t("w_owner_group_privacy")}
      </p>
    </>
  );
}
