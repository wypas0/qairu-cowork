import Form from "next/form";
import Link from "next/link";

import { IconArrowDown, IconChevronLeft, IconChevronRight, IconSearch, IconSend } from "@/components/icons";
import { INACTIVE_DAYS } from "@/db/repo";
import { type ListQuery, PAGE_SIZE, listHref } from "@/lib/ownerQuery";
import { type T, initials } from "./format";

/* Части списков консоли: поиск, фильтры, порядок, страницы, человек в строке.
   Всё — обычные ссылки и форма GET: состояние живёт в адресе, страница
   рендерится на сервере, своего клиентского JS нет. */

type AnyQuery = ListQuery<string, string>;

/** Поиск: форма GET (next/form — переход без перезагрузки, но работает и без JS). Фильтр и порядок сохраняются. */
export function ListSearch({
  t,
  base,
  query,
  defaultSort,
  placeholder,
}: {
  t: T;
  base: string;
  query: AnyQuery;
  defaultSort: string;
  placeholder: string;
}) {
  return (
    <Form action={base} className="owner-search" role="search">
      <label className="owner-search-field">
        <span className="owner-sr">{t("w_owner_search_label")}</span>
        <IconSearch size={18} />
        <input type="search" name="q" defaultValue={query.q} placeholder={placeholder} maxLength={64} autoComplete="off" spellCheck={false} />
      </label>
      {query.filter && <input type="hidden" name="filter" value={query.filter} />}
      {query.sort !== defaultSort && <input type="hidden" name="sort" value={query.sort} />}
      {query.dir !== "desc" && <input type="hidden" name="dir" value={query.dir} />}
      <button className="btn btn-primary" type="submit">
        {t("w_owner_search_btn")}
      </button>
      {query.q && (
        <Link className="btn" href={listHref(base, query, { q: "" }, defaultSort)} prefetch={false}>
          {t("w_owner_search_reset")}
        </Link>
      )}
    </Form>
  );
}

/** Фильтры пилюлями с числом: сколько подходит под текущий поиск. */
export function ListFilters<F extends string>({
  t,
  base,
  query,
  defaultSort,
  filters,
  counts,
}: {
  t: T;
  base: string;
  query: ListQuery<string, F>;
  defaultSort: string;
  filters: { key: F | null; label: string }[];
  counts: Record<string, number>;
}) {
  return (
    <nav className="owner-chips" aria-label={t("w_owner_filters")}>
      {filters.map(({ key, label }) => {
        const active = query.filter === key;
        return (
          <Link
            key={key ?? "all"}
            href={listHref(base, query as AnyQuery, { filter: key }, defaultSort)}
            prefetch={false}
            className={`owner-chip${active ? " active" : ""}`}
            aria-current={active ? "true" : undefined}
          >
            {t(label)} <span className="owner-chip-count tnum">{counts[key ?? "all"] ?? 0}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/** Порядок: сегменты по полю и стрелка направления. */
export function ListSort<S extends string>({
  t,
  base,
  query,
  defaultSort,
  sorts,
}: {
  t: T;
  base: string;
  query: ListQuery<S, string>;
  defaultSort: S;
  sorts: { key: S; label: string }[];
}) {
  const asc = query.dir === "asc";
  return (
    <div className="owner-sort">
      <span className="small muted">{t("w_owner_sort")}</span>
      <div className="owner-seg">
        {sorts.map(({ key, label }) => (
          <Link
            key={key}
            href={listHref(base, query as AnyQuery, { sort: key }, defaultSort)}
            prefetch={false}
            className={query.sort === key ? "active" : undefined}
            aria-current={query.sort === key ? "true" : undefined}
          >
            {t(label)}
          </Link>
        ))}
      </div>
      <Link
        className="btn btn-sm btn-quiet owner-dir"
        href={listHref(base, query as AnyQuery, { dir: asc ? "desc" : "asc" }, defaultSort)}
        prefetch={false}
        title={t(asc ? "w_owner_dir_asc" : "w_owner_dir_desc")}
      >
        <IconArrowDown size={16} className={asc ? "owner-dir-up" : undefined} />
        <span>{t(asc ? "w_owner_dir_asc" : "w_owner_dir_desc")}</span>
      </Link>
    </div>
  );
}

/** «Найдено: N · Стр. 2 из 7» и ссылки назад/дальше. */
export function ListPager({
  t,
  base,
  query,
  defaultSort,
  total,
  n,
}: {
  t: T;
  base: string;
  query: AnyQuery;
  defaultSort: string;
  total: number;
  n: (value: number) => string;
}) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = query.page;
  return (
    <nav className="owner-pager" aria-label={t("w_owner_pages")}>
      <span className="small muted tnum">
        {t("w_owner_found", { n: n(total) })} · {t("w_owner_page", { page: n(page), pages: n(pages) })}
      </span>
      <span className="owner-pager-links">
        {page > 1 ? (
          <Link className="btn btn-sm" href={listHref(base, query, { page: Math.min(page - 1, pages) }, defaultSort)} prefetch={false} rel="prev">
            <IconChevronLeft size={16} /> {t("w_owner_prev")}
          </Link>
        ) : null}
        {page < pages ? (
          <Link className="btn btn-sm" href={listHref(base, query, { page: page + 1 }, defaultSort)} prefetch={false} rel="next">
            {t("w_owner_next")} <IconChevronRight size={16} />
          </Link>
        ) : null}
      </span>
    </nav>
  );
}

/** Кружок: фото профиля, если есть, иначе две буквы имени. */
export function OwnerAvatar({ userId, name, avatarAt }: { userId: number; name: string; avatarAt: Date | null }) {
  return avatarAt ? (
    // eslint-disable-next-line @next/next/no-img-element -- своё маленькое фото, оптимизатор Next не нужен
    <img className="owner-avatar" src={`/api/avatar/${userId}?v=${avatarAt.getTime()}`} alt="" width={32} height={32} loading="lazy" />
  ) : (
    <span className="owner-avatar" aria-hidden="true">
      {initials(name)}
    </span>
  );
}

/** Ссылка на профиль в Telegram по нику. Без ника открыть человека нельзя — только написать ботом. */
export function telegramUrl(username: string | null): string | null {
  return username ? `https://t.me/${encodeURIComponent(username)}` : null;
}

/**
 * Telegram человека в строке: @ник ссылкой на профиль и id; без ника — пометка.
 * Заведённым на сайте — «только сайт»: ни ника, ни id из Telegram у них нет.
 */
export function TelegramCell({
  t,
  user,
}: {
  t: T;
  user: { userId: number; username: string | null; isWeb: boolean };
}) {
  if (user.isWeb) return <span className="badge">{t("w_owner_site_only")}</span>;
  const url = telegramUrl(user.username);
  return (
    <span className="owner-tg">
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="owner-tg-link">
          <IconSend size={13} />@{user.username}
        </a>
      ) : (
        <span className="muted">{t("w_owner_no_nick")}</span>
      )}
      <span className="small muted tnum">{user.userId}</span>
    </span>
  );
}

/** Группы человека ссылками на их карточки: первые две, остальные — числом («ещё 1» не пишем — покажем саму). */
export function GroupLinks({
  t,
  groups,
  limit = 2,
}: {
  t: T;
  groups: { chatId: number; title: string; slug: string | null }[];
  limit?: number;
}) {
  if (groups.length === 0) return <span className="muted">—</span>;
  const shown = groups.length <= limit + 1 ? groups : groups.slice(0, limit);
  const rest = groups.length - shown.length;
  return (
    <span className="owner-groups">
      {shown.map((group) => (
        <Link key={group.chatId} href={`/admin/groups/${group.chatId}`} prefetch={false} className="owner-group-chip">
          {group.title || group.slug || group.chatId}
        </Link>
      ))}
      {rest > 0 && <span className="small muted">{t("w_owner_groups_more", { n: rest })}</span>}
    </span>
  );
}

/** Сколько без действий: «сегодня», «3 дн. назад», с месяца — плашкой «неактивен». */
export function Idle({ t, n, idle }: { t: T; n: (value: number) => string; idle: number }) {
  if (idle >= INACTIVE_DAYS) return <span className="badge stale">{t("w_owner_inactive_days", { n: n(idle) })}</span>;
  return <>{idle === 0 ? t("w_owner_today") : t("w_owner_days_ago", { n: n(idle) })}</>;
}
