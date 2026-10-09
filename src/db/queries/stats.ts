/**
 * Статистика для консоли владельца (/admin): только агрегаты по своим
 * таблицам — без трекеров, без персональных данных и без записи в базу на
 * каждый просмотр. Всё считается одним запросом: на Supabase Free через пулер
 * каждый лишний round-trip — это десятки миллисекунд.
 */

import "server-only";

import { sql } from "drizzle-orm";
import { type Exec, ex } from "./base";

export type SiteStats = {
  users: {
    total: number;
    newDay: number;
    newWeek: number;
    newMonth: number;
    /** Разных людей с любым действием за сутки / 7 / 30 дней (заход на сайт, расписание, ответы, встречи). */
    dau: number;
    wau: number;
    mau: number;
    /** Регистрации по дням в поясе `tz`, только дни, где они были: «2026-10-01» → 3. */
    signups: { day: string; count: number }[];
  };
  groups: { total: number; withTwoPlus: number; live: number; avgSize: number; withMeetingMonth: number };
  schedule: {
    filled: number;
    origins: { origin: string; count: number }[];
    versions: { version: string; count: number }[];
  };
  meetings: {
    total: number;
    week: number;
    month: number;
    upcoming: number;
    past: number;
    cancelled: number;
    responses: number;
    answers: { yes: number; no: number; change: number };
    asked: number;
    attended: number;
  };
  db: { bytes: number; tables: { name: string; bytes: number; rows: number }[] };
};

const DAY = 86_400_000;
/** На сколько дней назад строится график регистраций. */
export const SIGNUP_DAYS = 90;

type Row = Record<string, unknown>;

/** postgres.js отдаёт строки массивом, PGlite (тесты) — в поле rows. */
function rowsOf(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  return ((result as { rows?: Row[] }).rows ?? []) as Row[];
}

const num = (value: unknown) => Number(value ?? 0) || 0;
const list = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

export async function siteStats(now = new Date(), tz = "Asia/Almaty", exec?: Exec): Promise<SiteStats> {
  const at = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const nowIso = now.toISOString();
  const [day, week, month, since] = [at(DAY), at(7 * DAY), at(30 * DAY), at(SIGNUP_DAYS * DAY)];

  // Активность — по отметкам, которые и так пишутся: заход на сайт (не чаще
  // раза в час), сохранение расписания, ответы и встречи. Отдельной записи
  // ради статистики нет. Сессии без заходов дольше 30 дней удаляет cron —
  // поэтому окно больше 30 дней тут не имеет смысла.
  const result = await ex(exec).execute(sql`
    with active as (
      select user_id, last_seen_at as at from web_sessions where last_seen_at >= ${month}::timestamptz
      union all select user_id, updated_at from schedule_state where updated_at >= ${month}::timestamptz
      union all select user_id, responded_at from meeting_responses where responded_at >= ${month}::timestamptz
      union all select user_id, answered_at from meeting_attendance where answered_at >= ${month}::timestamptz
      union all select initiator_id, created_at from meetings where created_at >= ${month}::timestamptz
    ),
    sizes as (select chat_id, count(*)::int as n from memberships group by chat_id),
    today as (select (${nowIso}::timestamptz at time zone ${tz}::text)::date as d)
    select
      (select count(*)::int from users) as users_total,
      (select count(*)::int from users where created_at >= ${day}::timestamptz) as users_day,
      (select count(*)::int from users where created_at >= ${week}::timestamptz) as users_week,
      (select count(*)::int from users where created_at >= ${month}::timestamptz) as users_month,
      (select count(distinct user_id)::int from active where at >= ${day}::timestamptz) as dau,
      (select count(distinct user_id)::int from active where at >= ${week}::timestamptz) as wau,
      (select count(distinct user_id)::int from active) as mau,
      (select coalesce(json_agg(json_build_object('day', s.day, 'count', s.n) order by s.day), '[]'::json)
         from (select to_char(created_at at time zone ${tz}::text, 'YYYY-MM-DD') as day, count(*)::int as n
                 from users where created_at >= ${since}::timestamptz group by 1) s) as signups,

      (select count(*)::int from chats) as groups_total,
      (select count(*)::int from sizes where n >= 2) as groups_two,
      (select coalesce(round(avg(n)::numeric, 1), 0)::float8 from sizes) as groups_avg,
      (select count(*)::int from sizes s where s.n >= 2 and exists (
         select 1 from memberships m join active a on a.user_id = m.user_id where m.chat_id = s.chat_id)) as groups_live,
      (select count(distinct chat_id)::int from meetings where created_at >= ${month}::timestamptz) as groups_meeting,

      (select count(*)::int from schedule_state where filled) as filled,
      (select coalesce(json_agg(json_build_object('origin', s.origin, 'count', s.n) order by s.n desc, s.origin), '[]'::json)
         from (select origin, count(*)::int as n from schedule_state where filled group by origin) s) as origins,
      (select coalesce(json_agg(json_build_object('version', s.v, 'count', s.n) order by s.n desc, s.v), '[]'::json)
         from (select ext_version as v, count(*)::int as n from schedule_state
                where filled and ext_version is not null group by ext_version) s) as versions,

      (select count(*)::int from meetings) as meetings_total,
      (select count(*)::int from meetings where created_at >= ${week}::timestamptz) as meetings_week,
      (select count(*)::int from meetings where created_at >= ${month}::timestamptz) as meetings_month,
      (select count(*)::int from meetings, today where status <> 'cancelled' and when_start is not null
         and (when_start >= ${nowIso}::timestamptz or (repeat_until is not null and repeat_until >= today.d))) as meetings_upcoming,
      (select count(*)::int from meetings, today where status <> 'cancelled' and when_start < ${nowIso}::timestamptz
         and (repeat_until is null or repeat_until < today.d)) as meetings_past,
      (select count(*)::int from meetings where status = 'cancelled') as meetings_cancelled,
      (select coalesce(json_object_agg(s.answer, s.n), '{}'::json)
         from (select answer, count(*)::int as n from meeting_responses group by answer) s) as answers,
      (select count(*)::int from meeting_attendance) as asked,
      (select count(*)::int from meeting_attendance where attended) as attended,

      pg_database_size(current_database())::float8 as db_bytes,
      -- Точное число строк каждой таблицы тем же запросом: count(*) через
      -- query_to_xml. Таблиц полтора десятка, строк — тысячи, это дёшево.
      (select coalesce(json_agg(json_build_object('name', t.name, 'bytes', t.bytes, 'rows', t.n)
                                order by t.bytes desc, t.name), '[]'::json)
         from (select c.relname as name, pg_total_relation_size(c.oid)::float8 as bytes,
                      (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', n.nspname, c.relname),
                        false, true, '')))[1]::text::int as n
                 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public' and c.relkind = 'r') t) as tables
  `);

  const row = rowsOf(result)[0] ?? {};
  const answers = (row.answers ?? {}) as Record<string, number>;
  return {
    users: {
      total: num(row.users_total),
      newDay: num(row.users_day),
      newWeek: num(row.users_week),
      newMonth: num(row.users_month),
      dau: num(row.dau),
      wau: num(row.wau),
      mau: num(row.mau),
      signups: list<{ day: string; count: number }>(row.signups),
    },
    groups: {
      total: num(row.groups_total),
      withTwoPlus: num(row.groups_two),
      live: num(row.groups_live),
      avgSize: num(row.groups_avg),
      withMeetingMonth: num(row.groups_meeting),
    },
    schedule: {
      filled: num(row.filled),
      origins: list<{ origin: string; count: number }>(row.origins),
      versions: list<{ version: string; count: number }>(row.versions),
    },
    meetings: {
      total: num(row.meetings_total),
      week: num(row.meetings_week),
      month: num(row.meetings_month),
      upcoming: num(row.meetings_upcoming),
      past: num(row.meetings_past),
      cancelled: num(row.meetings_cancelled),
      responses: Object.values(answers).reduce((sum, value) => sum + num(value), 0),
      answers: { yes: num(answers.yes), no: num(answers.no), change: num(answers.change) },
      asked: num(row.asked),
      attended: num(row.attended),
    },
    db: {
      bytes: num(row.db_bytes),
      tables: list<{ name: string; bytes: number; rows: number }>(row.tables).map((table) => ({
        name: table.name,
        bytes: num(table.bytes),
        rows: num(table.rows),
      })),
    },
  };
}

/**
 * Ряд по дням для графика: все дни от `days - 1` дней назад до сегодня (в
 * поясе `tz`), пустые — нулём. Чистая функция — проверяется тестом.
 */
export function dailySeries(
  points: { day: string; count: number }[],
  days: number,
  now = new Date(),
  tz = "Asia/Almaty",
): { day: string; count: number }[] {
  const byDay = new Map(points.map((point) => [point.day, point.count]));
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  const [y, m, d] = fmt.format(now).split("-").map(Number);
  const out: { day: string; count: number }[] = [];
  // Календарные дни считаются через UTC-полдень: переходы на летнее время не съедят и не задвоят день.
  for (let back = days - 1; back >= 0; back -= 1) {
    const key = new Date(Date.UTC(y, m - 1, d - back, 12)).toISOString().slice(0, 10);
    out.push({ day: key, count: byDay.get(key) ?? 0 });
  }
  return out;
}
