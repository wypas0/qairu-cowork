/**
 * «Обзор» консоли владельца, вторая половина: воронка, удержание по
 * когортам, языки, рост групп, самые активные группы, какие функции в ходу,
 * до скольких людей не дотягивается бот. Только из того, что уже лежит в
 * базе: без трекеров и без записи на просмотр. Один запрос, идёт
 * параллельно с siteStats.
 */

import "server-only";

import { sql } from "drizzle-orm";
import { type Exec, ex } from "./base";
import { list, num, rowsOf } from "./rows";

const DAY = 86_400_000;
/** Сколько недельных когорт показывать. */
export const COHORT_WEEKS = 8;
/** На сколько дней назад строится график новых групп. */
export const GROUP_DAYS = 90;
/** Сколько групп в «самых активных». */
export const TOP_GROUPS = 5;

export type Cohort = {
  /** Понедельник недели регистрации, «2026-09-21». */
  week: string;
  size: number;
  /** active[k] — сколько из когорты что-то делали на k-й неделе после регистрации (0 — та же неделя). */
  active: number[];
};

export type Insights = {
  funnel: { registered: number; joined: number; filled: number; engaged: number };
  cohorts: Cohort[];
  langs: { lang: string; count: number }[];
  groupsByDay: { day: string; count: number }[];
  topGroups: {
    chatId: number;
    title: string;
    slug: string | null;
    size: number;
    activeMembers: number;
    meetings: number;
    responses: number;
  }[];
  features: {
    users: number;
    photo: number;
    campus: number;
    calendar: number;
    avatars: number;
    passwords: number;
    soft: number;
    recurringMeetings: number;
    recurringAuthors: number;
    meetings: number;
    summaries: number;
    attendance: number;
  };
  bot: {
    /** Люди с Telegram (не заведённые на сайте). */
    telegram: number;
    /** Заведены на сайте без Telegram — бот до них не дотянется в принципе. */
    web: number;
    /** Люди с Telegram, кому за 30 дней уведомление ушло на сайт: бот не смог написать. */
    unreachable: number;
  };
};

/**
 * Отметки времени, по которым видно, что человек что-то делал, — с `since`.
 * Почти все — «последнее» (заход в сессии, сохранение расписания), поэтому
 * старые недели когорт видны неполно: удержание здесь — нижняя граница.
 * Слоты занятости не в счёт: слоты из личного календаря пишет cron, а не человек.
 */
function events(since: string) {
  return sql`
  ev as (
    select user_id, created_at as at from web_sessions where created_at >= ${since}::timestamptz
    union all select user_id, last_seen_at from web_sessions where last_seen_at >= ${since}::timestamptz
    union all select user_id, updated_at from schedule_state where updated_at >= ${since}::timestamptz
    union all select user_id, responded_at from meeting_responses where responded_at >= ${since}::timestamptz
    union all select user_id, answered_at from meeting_attendance where answered_at >= ${since}::timestamptz
    union all select initiator_id, created_at from meetings where created_at >= ${since}::timestamptz
    union all select user_id, joined_at from memberships where joined_at >= ${since}::timestamptz
    union all select user_id, read_at from notices where read_at >= ${since}::timestamptz
  )`;
}

export async function ownerInsights(now = new Date(), tz = "Asia/Almaty", exec?: Exec): Promise<Insights> {
  const nowIso = now.toISOString();
  const month = new Date(now.getTime() - 30 * DAY).toISOString();
  const since = new Date(now.getTime() - GROUP_DAYS * DAY).toISOString();
  // С запасом в неделю до понедельника самой старой когорты; заодно покрывает 30 дней.
  const eventsSince = new Date(now.getTime() - (COHORT_WEEKS + 1) * 7 * DAY).toISOString();

  const result = await ex(exec).execute(sql`
    with ${events(eventsSince)},
    -- Понедельник текущей недели в поясе сайта и начало самой старой когорты.
    wk as (
      select date_trunc('week', ${nowIso}::timestamptz at time zone ${tz}::text)::date as this_week
    ),
    cohort as (
      select u.user_id, date_trunc('week', u.created_at at time zone ${tz}::text)::date as week
        from users u, wk
       where u.created_at at time zone ${tz}::text >= wk.this_week - ${(COHORT_WEEKS - 1) * 7}::int
    ),
    cohort_act as (
      select distinct c.week, c.user_id,
             (date_trunc('week', e.at at time zone ${tz}::text)::date - c.week) / 7 as k
        from cohort c join ev e on e.user_id = c.user_id
       where e.at at time zone ${tz}::text >= c.week
    ),
    active30 as (select distinct user_id from ev where at >= ${month}::timestamptz),
    engaged as (select user_id from meeting_responses union select initiator_id from meetings),
    joined as (select distinct user_id from memberships),
    filled as (select user_id from schedule_state where filled),
    gm as (
      select mt.chat_id,
             count(*) filter (where mt.created_at >= ${month}::timestamptz)::int as meetings,
             0 as responses
        from meetings mt group by mt.chat_id
      union all
      select mt.chat_id, 0, count(*)::int
        from meeting_responses r join meetings mt on mt.id = r.meeting_id
       where r.responded_at >= ${month}::timestamptz group by mt.chat_id
    ),
    top as (
      select c.chat_id, c.title, c.slug,
             (select count(*)::int from memberships m where m.chat_id = c.chat_id) as size,
             (select count(*)::int from memberships m join active30 a on a.user_id = m.user_id
               where m.chat_id = c.chat_id) as active_members,
             g.meetings, g.responses
        from (select chat_id, sum(meetings)::int as meetings, sum(responses)::int as responses
                from gm group by chat_id) g
        join chats c on c.chat_id = g.chat_id
       where g.meetings + g.responses > 0
       order by g.meetings * 3 + g.responses desc, c.chat_id
       limit ${TOP_GROUPS}
    )
    select
      (select count(*)::int from users) as registered,
      (select count(*)::int from joined) as joined,
      (select count(*)::int from joined j join filled f using (user_id)) as filled,
      (select count(*)::int from joined j join filled f using (user_id) join engaged e using (user_id)) as engaged,

      (select coalesce(json_agg(json_build_object('week', to_char(s.week, 'YYYY-MM-DD'), 'size', s.size, 'active', s.active)
                                order by s.week), '[]'::json)
         from (select c.week, count(*)::int as size,
                      (select coalesce(json_object_agg(a.k, a.n), '{}'::json)
                         from (select k, count(*)::int as n from cohort_act ca
                                where ca.week = c.week and k between 0 and ${COHORT_WEEKS - 1}::int group by k) a) as active
                 from cohort c group by c.week) s) as cohorts,

      (select coalesce(json_agg(json_build_object('lang', s.lang, 'count', s.n) order by s.n desc, s.lang), '[]'::json)
         from (select lang, count(*)::int as n from users group by lang) s) as langs,

      (select coalesce(json_agg(json_build_object('day', s.day, 'count', s.n) order by s.day), '[]'::json)
         from (select to_char(created_at at time zone ${tz}::text, 'YYYY-MM-DD') as day, count(*)::int as n
                 from chats where created_at >= ${since}::timestamptz group by 1) s) as groups_by_day,

      (select coalesce(json_agg(json_build_object('chat_id', t.chat_id, 'title', t.title, 'slug', t.slug, 'size', t.size,
                                                  'active_members', t.active_members, 'meetings', t.meetings,
                                                  'responses', t.responses)), '[]'::json)
         from top t) as top_groups,

      (select count(*)::int from schedule_state where filled and origin = 'photo') as f_photo,
      (select count(*)::int from schedule_state where filled and origin = 'campus') as f_campus,
      (select count(*)::int from users where calendar_url is not null and calendar_url <> '') as f_calendar,
      (select count(*)::int from avatars) as f_avatars,
      (select count(*)::int from credentials) as f_passwords,
      (select count(distinct user_id)::int from busy_slots where kind = 'soft') as f_soft,
      (select count(*)::int from meetings where repeat_until is not null) as f_recurring,
      (select count(distinct initiator_id)::int from meetings where repeat_until is not null) as f_recurring_authors,
      (select count(*)::int from meetings) as f_meetings,
      (select count(*)::int from meetings where summary <> '') as f_summaries,
      (select count(distinct user_id)::int from meeting_attendance) as f_attendance,

      (select count(*)::int from users where not is_web) as bot_telegram,
      (select count(*)::int from users where is_web) as bot_web,
      (select count(distinct n.user_id)::int from notices n join users u on u.user_id = n.user_id
        where not u.is_web and n.created_at >= ${month}::timestamptz) as bot_unreachable
  `);

  const row = rowsOf(result)[0] ?? {};
  const registered = num(row.registered);
  return {
    funnel: {
      registered,
      joined: num(row.joined),
      filled: num(row.filled),
      engaged: num(row.engaged),
    },
    cohorts: list<{ week: string; size: number; active: Record<string, number> }>(row.cohorts).map((cohort) => ({
      week: String(cohort.week),
      size: num(cohort.size),
      active: Array.from({ length: COHORT_WEEKS }, (_, k) => num(cohort.active?.[String(k)])),
    })),
    langs: list<{ lang: string; count: number }>(row.langs).map((item) => ({ lang: String(item.lang), count: num(item.count) })),
    groupsByDay: list<{ day: string; count: number }>(row.groups_by_day).map((item) => ({
      day: String(item.day),
      count: num(item.count),
    })),
    topGroups: list<Record<string, unknown>>(row.top_groups).map((group) => ({
      chatId: num(group.chat_id),
      title: String(group.title ?? ""),
      slug: (group.slug as string | null) ?? null,
      size: num(group.size),
      activeMembers: num(group.active_members),
      meetings: num(group.meetings),
      responses: num(group.responses),
    })),
    features: {
      users: registered,
      photo: num(row.f_photo),
      campus: num(row.f_campus),
      calendar: num(row.f_calendar),
      avatars: num(row.f_avatars),
      passwords: num(row.f_passwords),
      soft: num(row.f_soft),
      recurringMeetings: num(row.f_recurring),
      recurringAuthors: num(row.f_recurring_authors),
      meetings: num(row.f_meetings),
      summaries: num(row.f_summaries),
      attendance: num(row.f_attendance),
    },
    bot: { telegram: num(row.bot_telegram), web: num(row.bot_web), unreachable: num(row.bot_unreachable) },
  };
}

/**
 * Сколько недель когорта успела прожить к `now`: у когорты этой недели — 1
 * (только нулевая), у когорты 3 недели назад — 4. Остальные клетки таблицы
 * удержания пустые, а не нули. Чистая функция — проверяется тестом.
 */
export function cohortWeeksElapsed(week: string, now = new Date(), tz = "Asia/Almaty"): number {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  const [y, m, d] = fmt.format(now).split("-").map(Number);
  const today = Date.UTC(y, m - 1, d);
  const [wy, wm, wd] = week.split("-").map(Number);
  const start = Date.UTC(wy, wm - 1, wd);
  return Math.max(0, Math.floor((today - start) / (7 * DAY)) + 1);
}
