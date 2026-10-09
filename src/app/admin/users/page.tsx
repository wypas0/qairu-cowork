import Link from "next/link";

import { daysSince, originName } from "@/components/owner/format";
import { ListFilters, ListPager, ListSearch, ListSort, OwnerAvatar } from "@/components/owner/OwnerList";
import { ownerPage } from "@/components/owner/OwnerPage";
import * as repo from "@/db/repo";
import { displayName } from "@/db/schema";
import { ownerMetadata } from "@/lib/ownerGate";
import { PAGE_SIZE, type UserFilter, type UserSort, listHref, parseUserListQuery } from "@/lib/ownerQuery";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return ownerMetadata();
}

const BASE = "/admin/users";
const DEFAULT_SORT: UserSort = "created";
const FILTERS: { key: UserFilter | null; label: string }[] = [
  { key: null, label: "w_owner_filter_all" },
  { key: "new", label: "w_owner_filter_new" },
  { key: "unfilled", label: "w_owner_filter_unfilled" },
  { key: "inactive", label: "w_owner_filter_inactive" },
  { key: "ext", label: "w_owner_filter_ext" },
];
const SORTS: { key: UserSort; label: string }[] = [
  { key: "created", label: "w_owner_sort_created" },
  { key: "active", label: "w_owner_sort_active" },
  { key: "groups", label: "w_owner_sort_groups" },
];

/**
 * «Пользователи»: таблица с поиском, фильтрами, порядком и страницами.
 * Состояние — в адресе (?q=&filter=&sort=&dir=&page=), страница целиком
 * серверная, данные — одним запросом. На телефоне строки становятся карточками.
 */
export default ownerPage("users", async ({ t, fmt, query: params, now }) => {
  const query = parseUserListQuery(params);
  const list = await repo.listOwnerUsers(query, now);
  const pages = Math.max(1, Math.ceil(list.total / PAGE_SIZE));

  return (
    <section className="card owner-list" aria-labelledby="owner-users-title">
      <div className="card-head">
        <h2 id="owner-users-title">{t("w_owner_tab_users")}</h2>
        <p className="small muted">{t("w_owner_users_lead")}</p>
      </div>
      <ListSearch t={t} base={BASE} query={query} defaultSort={DEFAULT_SORT} placeholder={t("w_owner_search_ph_users")} />
      <ListFilters t={t} base={BASE} query={query} defaultSort={DEFAULT_SORT} filters={FILTERS} counts={list.counts} />
      <ListSort t={t} base={BASE} query={query} defaultSort={DEFAULT_SORT} sorts={SORTS} />

      {list.rows.length === 0 ? (
        <div className="owner-empty">
          <p className="muted">{t("w_owner_nothing")}</p>
          {query.page > pages && (
            <Link className="btn btn-sm" href={listHref(BASE, query, { page: 1 }, DEFAULT_SORT)} prefetch={false}>
              {t("w_owner_first_page")}
            </Link>
          )}
        </div>
      ) : (
        <div className="owner-table-wrap">
          <table className="owner-table owner-rows">
            <thead>
              <tr>
                <th scope="col">{t("w_owner_col_person")}</th>
                <th scope="col">{t("w_owner_col_via")}</th>
                <th scope="col">{t("w_owner_col_lang")}</th>
                <th scope="col">{t("w_owner_col_joined")}</th>
                <th scope="col">{t("w_owner_col_active")}</th>
                <th scope="col">{t("w_owner_col_groups")}</th>
                <th scope="col">{t("w_owner_col_schedule")}</th>
                <th scope="col">{t("w_owner_col_meetings")}</th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((row) => {
                const name = displayName(row);
                const idle = daysSince(row.lastActive, now);
                return (
                  <tr key={row.userId}>
                    <th scope="row">
                      <div className="owner-person-cell">
                        <OwnerAvatar userId={row.userId} name={name} avatarAt={row.avatarAt} />
                        <span className="owner-person">
                          <Link href={`${BASE}/${row.userId}`} prefetch={false} className="owner-person-name">
                            {name}
                          </Link>
                          <span className="small muted">
                            {[row.realName ? row.fullName : null, row.username ? `@${row.username}` : null, row.isWeb ? null : row.userId]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                      </div>
                    </th>
                    <td data-label={t("w_owner_col_via")}>
                      <span className={row.isWeb ? "badge" : "badge soon"}>{t(row.isWeb ? "w_owner_via_web" : "w_owner_via_tg")}</span>
                    </td>
                    <td data-label={t("w_owner_col_lang")}>{row.lang}</td>
                    <td data-label={t("w_owner_col_joined")} className="tnum">
                      {fmt.date(row.createdAt)}
                    </td>
                    <td data-label={t("w_owner_col_active")} className="tnum">
                      {idle >= repo.INACTIVE_DAYS ? (
                        <span className="badge stale">{t("w_owner_inactive_days", { n: fmt.n(idle) })}</span>
                      ) : idle === 0 ? (
                        t("w_owner_today")
                      ) : (
                        t("w_owner_days_ago", { n: fmt.n(idle) })
                      )}
                    </td>
                    <td data-label={t("w_owner_col_groups")} className="tnum">
                      {fmt.n(row.groups)}
                    </td>
                    <td data-label={t("w_owner_col_schedule")}>
                      {row.filled ? (
                        <span>
                          {originName(t, row.origin)}
                          {row.extVersion && <span className="muted tnum"> v{row.extVersion}</span>}
                          <span className="small muted tnum"> · {fmt.date(row.scheduleAt)}</span>
                        </span>
                      ) : (
                        <span className="muted">{t("w_owner_sched_none")}</span>
                      )}
                    </td>
                    <td data-label={t("w_owner_col_meetings")} className="tnum">
                      {fmt.n(row.made)} / {fmt.n(row.answers)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <ListPager t={t} base={BASE} query={query} defaultSort={DEFAULT_SORT} total={list.total} n={fmt.n} />
    </section>
  );
});
