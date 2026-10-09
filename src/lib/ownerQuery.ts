/**
 * Списки консоли владельца (/admin/users, /admin/groups): что пришло в
 * адресе — поиск, фильтр, сортировка, страница. Всё приводится к белому
 * списку: в SQL уходит только то, что здесь разрешено. Чистые функции — их
 * проверяют тесты, ими же страница строит ссылки.
 */

export type SearchParams = Record<string, string | string[] | undefined>;

export const USER_SORTS = ["created", "active", "groups"] as const;
export type UserSort = (typeof USER_SORTS)[number];
/** new — зарегистрировались за 7 дней, unfilled — без расписания, inactive — 30+ дней без действий, ext — расписание из расширения. */
export const USER_FILTERS = ["new", "unfilled", "inactive", "ext"] as const;
export type UserFilter = (typeof USER_FILTERS)[number];

export const GROUP_SORTS = ["created", "active", "size", "meetings"] as const;
export type GroupSort = (typeof GROUP_SORTS)[number];
/** live — двое и больше, и что-то происходило за 30 дней; small — один человек или пусто. */
export const GROUP_FILTERS = ["telegram", "web", "live", "small"] as const;
export type GroupFilter = (typeof GROUP_FILTERS)[number];

export type ListQuery<S extends string, F extends string> = {
  q: string;
  sort: S;
  dir: "asc" | "desc";
  filter: F | null;
  page: number;
};
export type UserListQuery = ListQuery<UserSort, UserFilter>;
export type GroupListQuery = ListQuery<GroupSort, GroupFilter>;

/** Строк на странице списка. */
export const PAGE_SIZE = 50;
/** Дальше этой страницы не листаем: OFFSET на миллионе строк — не наш случай. */
export const MAX_PAGE = 2000;
/** Длина поискового запроса: длиннее имён и ников всё равно не бывает. */
export const MAX_QUERY = 64;

function first(params: SearchParams, key: string): string {
  const value = params[key];
  return typeof value === "string" ? value : Array.isArray(value) ? (value[0] ?? "") : "";
}

function pick<T extends string>(allowed: readonly T[], value: string): T | null {
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function parseList<S extends string, F extends string>(
  params: SearchParams,
  sorts: readonly S[],
  filters: readonly F[],
): ListQuery<S, F> {
  const page = Number.parseInt(first(params, "page"), 10);
  return {
    q: first(params, "q").trim().slice(0, MAX_QUERY),
    sort: pick(sorts, first(params, "sort")) ?? sorts[0],
    dir: first(params, "dir") === "asc" ? "asc" : "desc",
    filter: pick(filters, first(params, "filter")),
    page: Number.isFinite(page) ? Math.min(MAX_PAGE, Math.max(1, page)) : 1,
  };
}

export function parseUserListQuery(params: SearchParams): UserListQuery {
  return parseList(params, USER_SORTS, USER_FILTERS);
}

export function parseGroupListQuery(params: SearchParams): GroupListQuery {
  return parseList(params, GROUP_SORTS, GROUP_FILTERS);
}

/**
 * Что искать: «@Amir» → ник без «@»; число — ещё и Telegram id (у групп —
 * chat id, он бывает отрицательным). Пусто — без поиска.
 */
export function searchTerm(q: string): { text: string; id: number | null } | null {
  const text = q.trim().replace(/^@+/, "").slice(0, MAX_QUERY);
  if (!text) return null;
  const id = /^-?\d{1,16}$/.test(text) ? Number(text) : null;
  return { text, id: id !== null && Number.isSafeInteger(id) ? id : null };
}

/**
 * Ссылка на тот же список с изменёнными параметрами. Значения по умолчанию в
 * адрес не пишутся; смена поиска, фильтра или сортировки сбрасывает страницу.
 */
export function listHref<S extends string, F extends string>(
  base: string,
  query: ListQuery<S, F>,
  patch: Partial<ListQuery<S, F>>,
  defaultSort: S,
): string {
  const next = { ...query, ...patch };
  if (!("page" in patch)) next.page = 1;
  const params = new URLSearchParams();
  if (next.q) params.set("q", next.q);
  if (next.filter) params.set("filter", next.filter);
  if (next.sort !== defaultSort) params.set("sort", next.sort);
  if (next.dir !== "desc") params.set("dir", next.dir);
  if (next.page > 1) params.set("page", String(next.page));
  const search = params.toString();
  return search ? `${base}?${search}` : base;
}

/** id из адреса карточки: целое число в пределах Number, иначе null (→ «не найдено»). */
export function parseEntityId(raw: string): number | null {
  if (!/^-?\d{1,17}$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id !== 0 ? id : null;
}

/** Куда вернуться после действия консоли: только свои адреса /admin…, без чужих хостов и протоколов. */
export function safeOwnerPath(raw: unknown): string {
  const value = typeof raw === "string" ? raw : "";
  return /^\/admin(?:\/[A-Za-z0-9_-]+)*$/.test(value) ? value : "/admin";
}
