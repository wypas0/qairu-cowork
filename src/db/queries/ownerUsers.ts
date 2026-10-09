/**
 * Консоль владельца: люди и группы — списки с поиском, фильтрами и
 * страницами, карточка человека и группы.
 *
 * Каждая страница — один запрос: на Supabase Free через пулер лишний
 * round-trip стоит десятки миллисекунд. Списки считают агрегаты по всем
 * таблицам хеш-группировкой (один проход по каждой), а не подзапросом на
 * строку; поиск и фильтры — в том же запросе, страница — LIMIT/OFFSET.
 *
 * Чего здесь нет намеренно: токенов и хешей сессий, ссылки личного
 * календаря (она секрет — только «подключён» и код ошибки), пароля и логина,
 * текстов встреч и комментариев.
 */

import "server-only";

import { type SQL, sql } from "drizzle-orm";
import {
  type GroupFilter,
  type GroupListQuery,
  PAGE_SIZE,
  type UserFilter,
  type UserListQuery,
  searchTerm,
} from "@/lib/ownerQuery";
import { type Exec, ex } from "./base";
import { dateOrNull, likePattern, list, num, rowsOf, type Row } from "./rows";

const DAY = 86_400_000;

/** Сегодняшний день в поясе сайта — граница «серия ещё идёт» (repeat_until — дата в поясе группы). */
function today(now: Date, tz: string): SQL {
  return sql`(${now.toISOString()}::timestamptz at time zone ${tz}::text)::date`;
}
/** Сколько дней без действий — «неактивен». */
export const INACTIVE_DAYS = 30;
/** Сколько дней — «новый». */
export const NEW_DAYS = 7;

/**
 * Последнее действие каждого человека — по отметкам, которые и так пишутся:
 * заход на сайт, сохранение расписания, ответ на встречу, отметка посещения,
 * создание встречи, вступление в группу. Отдельной записи ради консоли нет.
 * Сессии без заходов 30 дней удаляет cron, так что заход старше месяца
 * виден только через другие отметки.
 */
export const LAST_ACTIVITY = sql`
  last_act as (
    select user_id, max(at) as at from (
      select user_id, max(last_seen_at) as at from web_sessions group by user_id
      union all select user_id, updated_at from schedule_state
      union all select user_id, max(responded_at) from meeting_responses group by user_id
      union all select user_id, max(answered_at) from meeting_attendance group by user_id
      union all select initiator_id, max(created_at) from meetings group by initiator_id
      union all select user_id, max(joined_at) from memberships group by user_id
    ) e group by user_id
  )`;

// --------------------------------------------------------------------------
// Список людей
// --------------------------------------------------------------------------

export type OwnerUserRow = {
  userId: number;
  username: string | null;
  fullName: string;
  realName: string | null;
  lang: string;
  isWeb: boolean;
  createdAt: Date;
  lastActive: Date;
  groups: number;
  filled: boolean;
  origin: string | null;
  extVersion: string | null;
  scheduleAt: Date | null;
  made: number;
  answers: number;
  avatarAt: Date | null;
};

export type OwnerUserList = {
  rows: OwnerUserRow[];
  /** Сколько подходит под поиск и фильтр — для страниц. */
  total: number;
  /** Сколько подходит под поиск в каждом фильтре — числа на кнопках. */
  counts: Record<"all" | UserFilter, number>;
};

const USER_ORDER: Record<UserListQuery["sort"], string> = {
  created: "created_at",
  active: "last_active",
  groups: "groups",
};

const USER_FILTER_SQL: Record<UserFilter, string> = {
  new: "is_new",
  unfilled: "not filled",
  inactive: "is_inactive",
  ext: "is_ext",
};

function userSearch(q: string): SQL {
  const term = searchTerm(q);
  if (!term) return sql`true`;
  const like = likePattern(term.text);
  const byText = sql`(u.full_name ilike ${like} or u.real_name ilike ${like} or u.username ilike ${like})`;
  return term.id !== null ? sql`(${byText} or u.user_id = ${term.id})` : byText;
}

function userRow(raw: Row): OwnerUserRow {
  return {
    userId: num(raw.user_id),
    username: (raw.username as string | null) ?? null,
    fullName: String(raw.full_name ?? ""),
    realName: (raw.real_name as string | null) || null,
    lang: String(raw.lang ?? ""),
    isWeb: Boolean(raw.is_web),
    createdAt: dateOrNull(raw.created_at) ?? new Date(0),
    lastActive: dateOrNull(raw.last_active) ?? dateOrNull(raw.created_at) ?? new Date(0),
    groups: num(raw.groups),
    filled: Boolean(raw.filled),
    origin: (raw.origin as string | null) ?? null,
    extVersion: (raw.ext_version as string | null) ?? null,
    scheduleAt: dateOrNull(raw.schedule_at),
    made: num(raw.made),
    answers: num(raw.answers),
    avatarAt: dateOrNull(raw.avatar_at),
  };
}

/** Люди для вкладки «Пользователи»: поиск, фильтр, сортировка, страница — одним запросом. */
export async function listOwnerUsers(query: UserListQuery, now = new Date(), exec?: Exec): Promise<OwnerUserList> {
  const week = new Date(now.getTime() - NEW_DAYS * DAY).toISOString();
  const month = new Date(now.getTime() - INACTIVE_DAYS * DAY).toISOString();
  const order = USER_ORDER[query.sort];
  const dir = query.dir === "asc" ? "asc" : "desc";
  // Порядок полностью определён: при равных значениях — по id, иначе страницы
  // могли бы показывать одного человека дважды.
  const orderBy = sql.raw(`${order} ${dir} nulls last, user_id ${dir}`);
  const filter = query.filter ? sql.raw(USER_FILTER_SQL[query.filter]) : sql`true`;
  const offset = (query.page - 1) * PAGE_SIZE;

  const result = await ex(exec).execute(sql`
    with ${LAST_ACTIVITY},
    grp as (select user_id, count(*)::int as n from memberships group by user_id),
    made as (select initiator_id as user_id, count(*)::int as n from meetings group by initiator_id),
    ans as (select user_id, count(*)::int as n from meeting_responses group by user_id),
    base as (
      select u.user_id, u.username, u.full_name, u.real_name, u.lang, u.is_web, u.created_at,
             greatest(u.created_at, la.at) as last_active,
             coalesce(g.n, 0) as groups,
             coalesce(ss.filled, false) as filled,
             case when ss.filled then ss.origin end as origin,
             case when ss.filled then ss.ext_version end as ext_version,
             ss.updated_at as schedule_at,
             coalesce(m.n, 0) as made,
             coalesce(a.n, 0) as answers,
             av.updated_at as avatar_at,
             u.created_at >= ${week}::timestamptz as is_new,
             greatest(u.created_at, la.at) < ${month}::timestamptz as is_inactive,
             coalesce(ss.filled and ss.origin = 'campus', false) as is_ext
        from users u
        left join last_act la on la.user_id = u.user_id
        left join grp g on g.user_id = u.user_id
        left join schedule_state ss on ss.user_id = u.user_id
        left join made m on m.user_id = u.user_id
        left join ans a on a.user_id = u.user_id
        left join avatars av on av.user_id = u.user_id
       where ${userSearch(query.q)}
    )
    select
      (select json_build_object(
         'all', count(*),
         'new', count(*) filter (where is_new),
         'unfilled', count(*) filter (where not filled),
         'inactive', count(*) filter (where is_inactive),
         'ext', count(*) filter (where is_ext)) from base) as counts,
      (select count(*)::int from base where ${filter}) as total,
      (select coalesce(json_agg(p), '[]'::json) from (
         select user_id, username, full_name, real_name, lang, is_web, created_at, last_active, groups,
                filled, origin, ext_version, schedule_at, made, answers, avatar_at
           from base where ${filter}
          order by ${orderBy}
          limit ${PAGE_SIZE} offset ${offset}) p) as rows
  `);

  const row = rowsOf(result)[0] ?? {};
  const counts = (row.counts ?? {}) as Record<string, unknown>;
  return {
    rows: list<Row>(row.rows).map(userRow),
    total: num(row.total),
    counts: {
      all: num(counts.all),
      new: num(counts.new),
      unfilled: num(counts.unfilled),
      inactive: num(counts.inactive),
      ext: num(counts.ext),
    },
  };
}

// --------------------------------------------------------------------------
// Карточка человека
// --------------------------------------------------------------------------

export type OwnerUserGroup = {
  chatId: number;
  slug: string | null;
  title: string;
  origin: string;
  role: string;
  joinedAt: Date | null;
  size: number;
  filled: number;
};

export type OwnerUserDetail = {
  user: OwnerUserRow & {
    hasPassword: boolean;
    calendar: { connected: boolean; syncedAt: Date | null; error: string | null };
  };
  groups: OwnerUserGroup[];
  schedule: {
    /** Строк в busy_slots по видам записи. */
    weekly: number;
    soft: number;
    dated: number;
    periods: number;
    fromCalendar: number;
    firstAt: Date | null;
  };
  meetings: {
    made: number;
    madeUpcoming: number;
    madeRecurring: number;
    lastMadeAt: Date | null;
    invited: number;
    answers: { yes: number; no: number; change: number };
    lastAnswerAt: Date | null;
    asked: number;
    attended: number;
  };
  sessions: { count: number; lastSeenAt: Date | null; firstAt: Date | null };
  notices: { total: number; unread: number; lastAt: Date | null };
};

/** Всё о человеке для карточки — одним запросом. null — такого нет. */
export async function ownerUserDetail(
  userId: number,
  now = new Date(),
  tz = "Asia/Almaty",
  exec?: Exec,
): Promise<OwnerUserDetail | null> {
  const nowIso = now.toISOString();
  const id = String(userId);
  const result = await ex(exec).execute(sql`
    with u as (
      -- Колонки перечислены явно: ссылка календаря (секрет) не выбирается вовсе.
      select user_id, username, full_name, real_name, lang, is_web, created_at, calendar_synced_at, calendar_error,
             calendar_url is not null and calendar_url <> '' as calendar_on
        from users where user_id = ${userId}
    ),
    last_act as (
      select max(at) as at from (
        select max(last_seen_at) as at from web_sessions where user_id = ${userId}
        union all select updated_at from schedule_state where user_id = ${userId}
        union all select max(responded_at) from meeting_responses where user_id = ${userId}
        union all select max(answered_at) from meeting_attendance where user_id = ${userId}
        union all select max(created_at) from meetings where initiator_id = ${userId}
        union all select max(joined_at) from memberships where user_id = ${userId}
      ) e
    )
    select
      u.user_id, u.username, u.full_name, u.real_name, u.lang, u.is_web, u.created_at,
      greatest(u.created_at, (select at from last_act)) as last_active,
      u.calendar_on, u.calendar_synced_at, u.calendar_error,
      exists (select 1 from credentials c where c.user_id = u.user_id) as has_password,
      (select updated_at from avatars where user_id = u.user_id) as avatar_at,
      ss.filled, ss.origin, ss.ext_version, ss.updated_at as schedule_at,

      (select coalesce(json_agg(json_build_object(
          'chat_id', c.chat_id, 'slug', c.slug, 'title', c.title, 'origin', c.origin, 'role', m.role,
          'joined_at', m.joined_at,
          'size', (select count(*) from memberships x where x.chat_id = c.chat_id),
          'filled', (select count(*) from memberships x join schedule_state s on s.user_id = x.user_id
                      where x.chat_id = c.chat_id and s.filled))
          order by m.joined_at desc), '[]'::json)
         from memberships m join chats c on c.chat_id = m.chat_id where m.user_id = u.user_id) as groups,

      (select json_build_object(
          'weekly', count(*) filter (where weekday is not null and kind <> 'soft' and source <> 'ics'),
          'soft', count(*) filter (where kind = 'soft'),
          'dated', count(*) filter (where specific_date is not null and source <> 'ics'),
          'periods', count(*) filter (where date_from is not null),
          'ics', count(*) filter (where source = 'ics'),
          'first_at', min(created_at))
         from busy_slots where user_id = u.user_id) as slots,

      (select json_build_object(
          'made', count(*),
          'upcoming', count(*) filter (where status <> 'cancelled' and when_start is not null
             and (when_start >= ${nowIso}::timestamptz or (repeat_until is not null and repeat_until >= ${today(now, tz)}))),
          'recurring', count(*) filter (where repeat_until is not null),
          'last_at', max(created_at))
         from meetings where initiator_id = u.user_id) as made,
      -- Приглашения хранятся строкой id через запятую; ищем id целиком, с границами.
      (select count(*)::int from meetings
        where (',' || invitees || ',') like ${`%,${id},%`} and initiator_id <> u.user_id) as invited,
      (select json_build_object(
          'yes', count(*) filter (where answer = 'yes'),
          'no', count(*) filter (where answer = 'no'),
          'change', count(*) filter (where answer = 'change'),
          'last_at', max(responded_at))
         from meeting_responses where user_id = u.user_id) as answers,
      (select json_build_object('asked', count(*), 'attended', count(*) filter (where attended))
         from meeting_attendance where user_id = u.user_id) as attendance,
      (select json_build_object('count', count(*), 'last_seen_at', max(last_seen_at), 'first_at', min(created_at))
         from web_sessions where user_id = u.user_id) as sessions,
      (select json_build_object('total', count(*), 'unread', count(*) filter (where read_at is null), 'last_at', max(created_at))
         from notices where user_id = u.user_id) as notices
    from u left join schedule_state ss on ss.user_id = u.user_id
  `);

  const row = rowsOf(result)[0];
  if (!row) return null;
  const obj = (value: unknown) => (value ?? {}) as Record<string, unknown>;
  const slots = obj(row.slots);
  const made = obj(row.made);
  const answers = obj(row.answers);
  const attendance = obj(row.attendance);
  const sessions = obj(row.sessions);
  const notices = obj(row.notices);
  const groups = list<Row>(row.groups).map(
    (group): OwnerUserGroup => ({
      chatId: num(group.chat_id),
      slug: (group.slug as string | null) ?? null,
      title: String(group.title ?? ""),
      origin: String(group.origin ?? ""),
      role: String(group.role ?? ""),
      joinedAt: dateOrNull(group.joined_at),
      size: num(group.size),
      filled: num(group.filled),
    }),
  );
  const base = userRow({
    ...row,
    filled: Boolean(row.filled),
    origin: row.filled ? row.origin : null,
    ext_version: row.filled ? row.ext_version : null,
    groups: groups.length,
    made: made.made,
    answers: num(answers.yes) + num(answers.no) + num(answers.change),
  });

  return {
    user: {
      ...base,
      hasPassword: Boolean(row.has_password),
      calendar: {
        connected: Boolean(row.calendar_on),
        syncedAt: dateOrNull(row.calendar_synced_at),
        error: (row.calendar_error as string | null) || null,
      },
    },
    groups,
    schedule: {
      weekly: num(slots.weekly),
      soft: num(slots.soft),
      dated: num(slots.dated),
      periods: num(slots.periods),
      fromCalendar: num(slots.ics),
      firstAt: dateOrNull(slots.first_at),
    },
    meetings: {
      made: num(made.made),
      madeUpcoming: num(made.upcoming),
      madeRecurring: num(made.recurring),
      lastMadeAt: dateOrNull(made.last_at),
      invited: num(row.invited),
      answers: { yes: num(answers.yes), no: num(answers.no), change: num(answers.change) },
      lastAnswerAt: dateOrNull(answers.last_at),
      asked: num(attendance.asked),
      attended: num(attendance.attended),
    },
    sessions: {
      count: num(sessions.count),
      lastSeenAt: dateOrNull(sessions.last_seen_at),
      firstAt: dateOrNull(sessions.first_at),
    },
    notices: { total: num(notices.total), unread: num(notices.unread), lastAt: dateOrNull(notices.last_at) },
  };
}

// --------------------------------------------------------------------------
// Группы
// --------------------------------------------------------------------------

export type OwnerGroupRow = {
  chatId: number;
  slug: string | null;
  title: string;
  origin: string;
  createdAt: Date;
  lastActive: Date;
  size: number;
  filled: number;
  meetings: number;
  meetingsMonth: number;
  upcoming: number;
};

export type OwnerGroupList = {
  rows: OwnerGroupRow[];
  total: number;
  counts: Record<"all" | GroupFilter, number>;
};

const GROUP_ORDER: Record<GroupListQuery["sort"], string> = {
  created: "created_at",
  active: "last_active",
  size: "size",
  meetings: "meetings",
};

const GROUP_FILTER_SQL: Record<GroupFilter, string> = {
  telegram: "origin = 'telegram'",
  web: "origin = 'web'",
  live: "is_live",
  small: "size <= 1",
};

function groupSearch(q: string): SQL {
  const term = searchTerm(q);
  if (!term) return sql`true`;
  const like = likePattern(term.text);
  const byText = sql`(c.title ilike ${like} or c.slug ilike ${like})`;
  return term.id !== null ? sql`(${byText} or c.chat_id = ${term.id})` : byText;
}

function groupRow(raw: Row): OwnerGroupRow {
  return {
    chatId: num(raw.chat_id),
    slug: (raw.slug as string | null) ?? null,
    title: String(raw.title ?? ""),
    origin: String(raw.origin ?? ""),
    createdAt: dateOrNull(raw.created_at) ?? new Date(0),
    lastActive: dateOrNull(raw.last_active) ?? dateOrNull(raw.created_at) ?? new Date(0),
    size: num(raw.size),
    filled: num(raw.filled),
    meetings: num(raw.meetings),
    meetingsMonth: num(raw.meetings_month),
    upcoming: num(raw.upcoming),
  };
}

/**
 * Последнее, что происходило в группе: вступление, новая встреча, ответ на
 * её встречу, отметка посещения. Чьи-то действия в других группах не в счёт.
 */
const GROUP_ACTIVITY = sql`
  mem as (
    select m.chat_id, count(*)::int as size, count(*) filter (where s.filled)::int as filled, max(m.joined_at) as last_join
      from memberships m left join schedule_state s on s.user_id = m.user_id group by m.chat_id
  ),
  resp as (
    select mt.chat_id, max(r.responded_at) as at from meeting_responses r join meetings mt on mt.id = r.meeting_id group by mt.chat_id
  ),
  att as (
    select mt.chat_id, max(a.answered_at) as at from meeting_attendance a join meetings mt on mt.id = a.meeting_id group by mt.chat_id
  )`;

/** Группы для вкладки «Группы» — одним запросом. */
export async function listOwnerGroups(
  query: GroupListQuery,
  now = new Date(),
  tz = "Asia/Almaty",
  exec?: Exec,
): Promise<OwnerGroupList> {
  const nowIso = now.toISOString();
  const month = new Date(now.getTime() - 30 * DAY).toISOString();
  const dir = query.dir === "asc" ? "asc" : "desc";
  const orderBy = sql.raw(`${GROUP_ORDER[query.sort]} ${dir} nulls last, chat_id ${dir}`);
  const filter = query.filter ? sql.raw(GROUP_FILTER_SQL[query.filter]) : sql`true`;
  const offset = (query.page - 1) * PAGE_SIZE;

  const result = await ex(exec).execute(sql`
    with ${GROUP_ACTIVITY},
    mt as (
      select chat_id, count(*)::int as n,
             count(*) filter (where created_at >= ${month}::timestamptz)::int as month,
             count(*) filter (where status <> 'cancelled' and when_start is not null
               and (when_start >= ${nowIso}::timestamptz or (repeat_until is not null and repeat_until >= ${today(now, tz)})))::int as upcoming,
             max(created_at) as last_at
        from meetings group by chat_id
    ),
    base as (
      select c.chat_id, c.slug, c.title, c.origin, c.created_at,
             coalesce(mem.size, 0) as size, coalesce(mem.filled, 0) as filled,
             coalesce(mt.n, 0) as meetings, coalesce(mt.month, 0) as meetings_month, coalesce(mt.upcoming, 0) as upcoming,
             greatest(c.created_at, mem.last_join, mt.last_at, resp.at, att.at) as last_active
        from chats c
        left join mem on mem.chat_id = c.chat_id
        left join mt on mt.chat_id = c.chat_id
        left join resp on resp.chat_id = c.chat_id
        left join att on att.chat_id = c.chat_id
       where ${groupSearch(query.q)}
    ),
    flagged as (
      select *, size >= 2 and last_active >= ${month}::timestamptz as is_live from base
    )
    select
      (select json_build_object(
         'all', count(*),
         'telegram', count(*) filter (where origin = 'telegram'),
         'web', count(*) filter (where origin = 'web'),
         'live', count(*) filter (where is_live),
         'small', count(*) filter (where size <= 1)) from flagged) as counts,
      (select count(*)::int from flagged where ${filter}) as total,
      (select coalesce(json_agg(p), '[]'::json) from (
         select chat_id, slug, title, origin, created_at, last_active, size, filled, meetings, meetings_month, upcoming
           from flagged where ${filter}
          order by ${orderBy}
          limit ${PAGE_SIZE} offset ${offset}) p) as rows
  `);

  const row = rowsOf(result)[0] ?? {};
  const counts = (row.counts ?? {}) as Record<string, unknown>;
  return {
    rows: list<Row>(row.rows).map(groupRow),
    total: num(row.total),
    counts: {
      all: num(counts.all),
      telegram: num(counts.telegram),
      web: num(counts.web),
      live: num(counts.live),
      small: num(counts.small),
    },
  };
}

export type OwnerGroupMember = {
  userId: number;
  username: string | null;
  fullName: string;
  realName: string | null;
  isWeb: boolean;
  role: string;
  joinedAt: Date | null;
  filled: boolean;
  origin: string | null;
  scheduleAt: Date | null;
  avatarAt: Date | null;
};

export type OwnerGroupDetail = {
  group: OwnerGroupRow & { tz: string; lang: string; semesterStart: string | null; createdBy: number | null };
  members: OwnerGroupMember[];
  meetings: {
    past: number;
    cancelled: number;
    recurring: number;
    withSummary: number;
    responses: number;
    asked: number;
    attended: number;
  };
};

/** Группа для карточки в консоли — одним запросом. null — такой нет. */
export async function ownerGroupDetail(
  chatId: number,
  now = new Date(),
  tz = "Asia/Almaty",
  exec?: Exec,
): Promise<OwnerGroupDetail | null> {
  const nowIso = now.toISOString();
  const month = new Date(now.getTime() - 30 * DAY).toISOString();
  const result = await ex(exec).execute(sql`
    with c as (select * from chats where chat_id = ${chatId}),
    gm as (select id, status, when_start, repeat_until, created_at, summary from meetings where chat_id = ${chatId})
    select c.chat_id, c.slug, c.title, c.origin, c.created_at, c.tz, c.lang, c.semester_start, c.created_by,
      (select count(*)::int from memberships where chat_id = c.chat_id) as size,
      (select count(*)::int from memberships m join schedule_state s on s.user_id = m.user_id
        where m.chat_id = c.chat_id and s.filled) as filled,
      (select count(*)::int from gm) as meetings,
      (select count(*)::int from gm where created_at >= ${month}::timestamptz) as meetings_month,
      (select count(*)::int from gm where status <> 'cancelled' and when_start is not null
         and (when_start >= ${nowIso}::timestamptz or (repeat_until is not null and repeat_until >= ${today(now, tz)}))) as upcoming,
      (select count(*)::int from gm where status <> 'cancelled' and when_start < ${nowIso}::timestamptz
         and (repeat_until is null or repeat_until < ${today(now, tz)})) as past,
      (select count(*)::int from gm where status = 'cancelled') as cancelled,
      (select count(*)::int from gm where repeat_until is not null) as recurring,
      (select count(*)::int from gm where summary <> '') as with_summary,
      (select count(*)::int from meeting_responses r join gm on gm.id = r.meeting_id) as responses,
      (select count(*)::int from meeting_attendance a join gm on gm.id = a.meeting_id) as asked,
      (select count(*)::int from meeting_attendance a join gm on gm.id = a.meeting_id where a.attended) as attended,
      greatest(c.created_at,
        (select max(joined_at) from memberships where chat_id = c.chat_id),
        (select max(created_at) from gm),
        (select max(r.responded_at) from meeting_responses r join gm on gm.id = r.meeting_id),
        (select max(a.answered_at) from meeting_attendance a join gm on gm.id = a.meeting_id)) as last_active,
      (select coalesce(json_agg(json_build_object(
          'user_id', u.user_id, 'username', u.username, 'full_name', u.full_name, 'real_name', u.real_name,
          'is_web', u.is_web, 'role', m.role, 'joined_at', m.joined_at,
          'filled', coalesce(s.filled, false), 'origin', case when s.filled then s.origin end,
          'schedule_at', s.updated_at,
          'avatar_at', (select updated_at from avatars av where av.user_id = u.user_id))
          order by m.role = 'admin' desc, m.joined_at), '[]'::json)
         from memberships m join users u on u.user_id = m.user_id
         left join schedule_state s on s.user_id = m.user_id
        where m.chat_id = c.chat_id) as members
    from c
  `);

  const row = rowsOf(result)[0];
  if (!row) return null;
  return {
    group: {
      ...groupRow(row),
      tz: String(row.tz ?? ""),
      lang: String(row.lang ?? ""),
      semesterStart: row.semester_start ? String(row.semester_start).slice(0, 10) : null,
      createdBy: row.created_by === null || row.created_by === undefined ? null : num(row.created_by),
    },
    members: list<Row>(row.members).map((member) => ({
      userId: num(member.user_id),
      username: (member.username as string | null) ?? null,
      fullName: String(member.full_name ?? ""),
      realName: (member.real_name as string | null) || null,
      isWeb: Boolean(member.is_web),
      role: String(member.role ?? ""),
      joinedAt: dateOrNull(member.joined_at),
      filled: Boolean(member.filled),
      origin: (member.origin as string | null) ?? null,
      scheduleAt: dateOrNull(member.schedule_at),
      avatarAt: dateOrNull(member.avatar_at),
    })),
    meetings: {
      past: num(row.past),
      cancelled: num(row.cancelled),
      recurring: num(row.recurring),
      withSummary: num(row.with_summary),
      responses: num(row.responses),
      asked: num(row.asked),
      attended: num(row.attended),
    },
  };
}
