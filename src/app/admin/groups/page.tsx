import Link from "next/link";

import { daysSince } from "@/components/owner/format";
import { ListFilters, ListPager, ListSearch, ListSort } from "@/components/owner/OwnerList";
import { ownerPage } from "@/components/owner/OwnerPage";
import * as repo from "@/db/repo";
import { ownerMetadata } from "@/lib/ownerGate";
import { type GroupFilter, type GroupSort, PAGE_SIZE, listHref, parseGroupListQuery } from "@/lib/ownerQuery";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return ownerMetadata();
}

const BASE = "/admin/groups";
const DEFAULT_SORT: GroupSort = "created";
const FILTERS: { key: GroupFilter | null; label: string }[] = [
  { key: null, label: "w_owner_filter_all" },
  { key: "live", label: "w_owner_gfilter_live" },
  { key: "telegram", label: "w_owner_gfilter_telegram" },
  { key: "web", label: "w_owner_gfilter_web" },
  { key: "small", label: "w_owner_gfilter_small" },
];
const SORTS: { key: GroupSort; label: string }[] = [
  { key: "created", label: "w_owner_gsort_created" },
  { key: "active", label: "w_owner_sort_active" },
  { key: "size", label: "w_owner_gsort_size" },
  { key: "meetings", label: "w_owner_gsort_meetings" },
];

/** «Группы»: размер, заполненность расписаний, встречи, последняя активность, откуда группа. */
export default ownerPage("groups", async ({ t, fmt, query: params, now }) => {
  const query = parseGroupListQuery(params);
  const list = await repo.listOwnerGroups(query, now, fmt.timeZone);
  const pages = Math.max(1, Math.ceil(list.total / PAGE_SIZE));

  return (
    <section className="card owner-list" aria-labelledby="owner-groups-title">
      <div className="card-head">
        <h2 id="owner-groups-title">{t("w_owner_tab_groups")}</h2>
        <p className="small muted">{t("w_owner_groups_lead")}</p>
      </div>
      <ListSearch t={t} base={BASE} query={query} defaultSort={DEFAULT_SORT} placeholder={t("w_owner_search_ph_groups")} />
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
                <th scope="col">{t("w_owner_col_group")}</th>
                <th scope="col">{t("w_owner_col_origin")}</th>
                <th scope="col">{t("w_owner_col_created")}</th>
                <th scope="col">{t("w_owner_col_size")}</th>
                <th scope="col">{t("w_owner_col_filled")}</th>
                <th scope="col">{t("w_owner_col_gmeetings")}</th>
                <th scope="col">{t("w_owner_col_active")}</th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((row) => {
                const idle = daysSince(row.lastActive, now);
                return (
                  <tr key={row.chatId}>
                    <th scope="row">
                      <span className="owner-person">
                        <Link href={`${BASE}/${row.chatId}`} prefetch={false} className="owner-person-name">
                          {row.title || row.slug || row.chatId}
                        </Link>
                        {row.slug && <span className="small muted">{row.slug}</span>}
                      </span>
                    </th>
                    <td data-label={t("w_owner_col_origin")}>
                      <span className={row.origin === "web" ? "badge" : "badge soon"}>
                        {t(row.origin === "web" ? "w_owner_via_web" : "w_owner_via_tg")}
                      </span>
                    </td>
                    <td data-label={t("w_owner_col_created")} className="tnum">
                      {fmt.date(row.createdAt)}
                    </td>
                    <td data-label={t("w_owner_col_size")} className="tnum">
                      {fmt.n(row.size)}
                    </td>
                    <td data-label={t("w_owner_col_filled")} className="tnum">
                      {fmt.n(row.filled)} · {fmt.percent(row.filled, row.size)}
                    </td>
                    <td data-label={t("w_owner_col_gmeetings")} className="tnum">
                      {fmt.n(row.meetings)} / {fmt.n(row.meetingsMonth)} / {fmt.n(row.upcoming)}
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
