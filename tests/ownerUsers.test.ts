/**
 * Консоль владельца: вкладки «Пользователи» и «Группы», карточки, «Обзор» и
 * общий гейт всех страниц /admin. Настоящая база (PGlite), куки и заголовки
 * запроса — подменой next/headers, «не найдено» — подменой next/navigation.
 */

import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { startTestDb } from "./support/db";

// --- запрос: куки и заголовки, которые прочитает страница ---
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => jar.set(name, value),
    delete: (name: string) => jar.delete(name),
  }),
  headers: async () => new Headers({ "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/129.0", "x-forwarded-for": "203.0.113.9" }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));

const OWNER = 7_200_001;
const OUTSIDER = 7_200_002;
const WEB_USER = -(10 ** 15) - 4242;
const DAY = 86_400_000;
const NOW = new Date();
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

let db: PGlite;
let ownerWeb: string;
let outsiderWeb: string;
let ownerConsole: string;

async function mods() {
  return {
    repo: await import("@/db/repo"),
    query: await import("@/lib/ownerQuery"),
  };
}

beforeAll(async () => {
  process.env.BOT_TOKEN = "123456:AAHtestTOKENtestTOKENtestTOKENtestTO";
  process.env.ALERT_CHAT_ID = String(OWNER);
  process.env.OWNER_IDS = "";
  db = await startTestDb();
  // Люди: владелец, посторонний, 60 «студентов» для страниц, веб-аккаунт.
  await db.exec(`
    insert into users (user_id, full_name, real_name, username, lang, is_web, created_at) values
      (${OWNER}, 'Владелец', null, 'owner', 'ru', false, '${ago(100)}'),
      (${OUTSIDER}, 'Чужой', null, 'someone', 'en', false, '${ago(100)}'),
      (${WEB_USER}, 'Веб', null, null, 'kk', true, '${ago(2)}');
    insert into users (user_id, full_name, real_name, username, lang, created_at)
      select 8000 + g, 'Студент ' || g, case when g = 7 then 'Айгерим 50%_x' end, 'stud' || g,
             case when g % 2 = 0 then 'ru' else 'kk' end, '${ago(60)}'::timestamptz + g * interval '1 hour'
        from generate_series(1, 60) g;
    -- Свежий: зарегистрирован вчера.
    update users set created_at = '${ago(1)}' where user_id = 8001;
    insert into chats (chat_id, slug, origin, title, created_at) values
      (-501, 'grpone', 'web', 'Первая группа', '${ago(50)}'),
      (-502, 'grptwo', 'telegram', 'Вторая', '${ago(40)}'),
      (-503, 'lonely', 'web', 'Одинокая', '${ago(90)}');
    insert into memberships (chat_id, user_id, role, joined_at) values
      (-501, 8001, 'admin', '${ago(1)}'), (-501, 8002, 'member', '${ago(1)}'), (-501, 8003, 'member', '${ago(1)}'),
      (-502, 8001, 'member', '${ago(5)}'), (-502, 8002, 'admin', '${ago(5)}'),
      (-503, 8004, 'admin', '${ago(90)}');
    update users set created_at = '${ago(90)}' where user_id = 8004;
    insert into schedule_state (user_id, filled, origin, ext_version, updated_at) values
      (8001, true, 'campus', '0.3.0', '${ago(1)}'),
      (8002, true, 'photo', null, '${ago(3)}'),
      (8003, false, 'manual', null, '${ago(3)}');
    update users set calendar_url = 'https://calendar.example/secret-feed-token.ics', calendar_synced_at = '${ago(1)}'
      where user_id = 8001;
    insert into busy_slots (user_id, weekday, start_min, end_min, kind, source) values
      (8001, 0, 540, 600, 'class', 'web'), (8001, 1, 540, 600, 'soft', 'web');
    insert into busy_slots (user_id, specific_date, start_min, end_min, kind, source) values
      (8001, current_date, 600, 660, 'other', 'ics');
    insert into meetings (id, chat_id, initiator_id, when_text, when_start, goal, invitees, status, repeat_until, summary, created_at) values
      (901, -501, 8001, 'x', '${new Date(NOW.getTime() + 2 * DAY).toISOString()}', 'секретная цель', '8001,8002,8003', 'open', null, '', '${ago(2)}'),
      (902, -501, 8002, 'x', '${ago(10)}', 'прошлая', '8001,8002', 'open', '${new Date(NOW.getTime() + 30 * DAY).toISOString().slice(0, 10)}', 'итоги', '${ago(12)}');
    insert into meeting_responses (meeting_id, user_id, answer, comment, responded_at) values
      (901, 8002, 'yes', 'секретный комментарий', '${ago(1)}'), (902, 8001, 'change', '', '${ago(9)}');
    insert into meeting_attendance (meeting_id, occurrence, user_id, attended, answered_at) values
      (902, current_date, 8001, true, '${ago(1)}');
    insert into notices (chat_id, user_id, kind, created_at) values (-501, 8003, 'meeting', '${ago(2)}');
    insert into avatars (user_id, mime, data, updated_at) values (8002, 'image/png', 'AAAA', '${ago(3)}');
    insert into credentials (user_id, login, password_hash) values (8002, 'stud2', 'scrypt$1$1$1$aa$bb');
  `);
  const { repo } = await mods();
  ownerWeb = await repo.issueWebSession(OWNER);
  outsiderWeb = await repo.issueWebSession(OUTSIDER);
  await repo.issueWebSession(8003);
  // Сессия консоли владельца — как её выдал бы верный код.
  const crypto = await import("node:crypto");
  ownerConsole = crypto.randomBytes(32).toString("base64url");
  await repo.insertOwnerSession({
    tokenHash: repo.hashToken(ownerConsole),
    userId: OWNER,
    webTokenHash: repo.hashToken(ownerWeb),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
});

beforeEach(() => {
  jar.clear();
  process.env.ALERT_CHAT_ID = String(OWNER);
  process.env.OWNER_IDS = "";
});

afterEach(() => {
  delete process.env.DEFAULT_TZ;
});

describe("параметры списка из адреса", () => {
  it("белый список: мусор — значения по умолчанию, страница в пределах", async () => {
    const { query } = await mods();
    expect(query.parseUserListQuery({})).toEqual({ q: "", sort: "created", dir: "desc", filter: null, page: 1 });
    expect(
      query.parseUserListQuery({ q: "  Амир ", sort: "drop table", dir: "up", filter: "admins", page: "-3" }),
    ).toEqual({ q: "Амир", sort: "created", dir: "desc", filter: null, page: 1 });
    expect(query.parseUserListQuery({ sort: ["active", "groups"], dir: "asc", filter: "ext", page: "999999" })).toMatchObject({
      sort: "active",
      dir: "asc",
      filter: "ext",
      page: query.MAX_PAGE,
    });
    expect(query.parseUserListQuery({ q: "x".repeat(500) }).q).toHaveLength(query.MAX_QUERY);
    expect(query.parseGroupListQuery({ sort: "meetings", filter: "live" })).toMatchObject({ sort: "meetings", filter: "live" });
    expect(query.parseGroupListQuery({ sort: "groups" }).sort).toBe("created");
  });

  it("поиск: @ник без собаки, число — ещё и id", async () => {
    const { query } = await mods();
    expect(query.searchTerm("  ")).toBeNull();
    expect(query.searchTerm("@Amir")).toEqual({ text: "Amir", id: null });
    expect(query.searchTerm("123456789")).toEqual({ text: "123456789", id: 123456789 });
    expect(query.searchTerm("-1001")).toEqual({ text: "-1001", id: -1001 });
    expect(query.searchTerm("99999999999999999")?.id).toBeNull();
  });

  it("ссылки: по умолчанию пусто, смена фильтра сбрасывает страницу", async () => {
    const { query } = await mods();
    const base = query.parseUserListQuery({ q: "a b", filter: "new", sort: "active", page: "3" });
    expect(query.listHref("/admin/users", base, { page: 4 }, "created")).toBe("/admin/users?q=a+b&filter=new&sort=active&page=4");
    expect(query.listHref("/admin/users", base, { filter: null }, "created")).toBe("/admin/users?q=a+b&sort=active");
    expect(query.listHref("/admin/users", query.parseUserListQuery({}), {}, "created")).toBe("/admin/users");
  });

  it("id карточки и адрес возврата — только свои", async () => {
    const { query } = await mods();
    expect(query.parseEntityId("123")).toBe(123);
    expect(query.parseEntityId("-1000000000004242")).toBe(-1000000000004242);
    for (const bad of ["", "0", "1e3", "12a", "99999999999999999999", "../1"]) expect(query.parseEntityId(bad)).toBeNull();
    expect(query.safeOwnerPath("/admin/users/-501")).toBe("/admin/users/-501");
    for (const bad of ["https://evil.example/admin", "//evil.example", "/admin/../g", "/administrator", null, "/admin?x=1"]) {
      expect(query.safeOwnerPath(bad)).toBe("/admin");
    }
  });
});

describe("список людей", () => {
  it("поиск по имени, настоящему имени, @нику и id", async () => {
    const { repo, query } = await mods();
    const find = async (q: string) => (await repo.listOwnerUsers(query.parseUserListQuery({ q }), NOW)).rows.map((row) => row.userId);
    expect(await find("Студент 13")).toEqual([8013]);
    expect(await find("айгерим")).toEqual([8007]);
    expect(await find("@stud42")).toEqual([8042]);
    expect(await find(String(OWNER))).toEqual([OWNER]);
    // % и _ — обычные буквы, а не шаблон LIKE.
    expect(await find("50%_")).toEqual([8007]);
    expect(await find("%")).toEqual([8007]);
    expect(await find("нет такого")).toEqual([]);
  });

  it("строка: группы, расписание и его источник, встречи, аватар — без лишнего", async () => {
    const { repo, query } = await mods();
    const { rows } = await repo.listOwnerUsers(query.parseUserListQuery({ q: "@stud1" }), NOW);
    const first = rows.find((row) => row.userId === 8001)!;
    expect(first).toMatchObject({ groups: 2, filled: true, origin: "campus", extVersion: "0.3.0", made: 1, answers: 1, isWeb: false });
    const second = (await repo.listOwnerUsers(query.parseUserListQuery({ q: "@stud2" }), NOW)).rows.find((row) => row.userId === 8002)!;
    expect(second).toMatchObject({ groups: 2, origin: "photo", made: 1, answers: 1 });
    expect(second.avatarAt).toBeInstanceOf(Date);
    expect(JSON.stringify(rows)).not.toContain("secret-feed-token");
  });

  it("фильтры и числа на них", async () => {
    const { repo, query } = await mods();
    const list = async (filter?: string) =>
      repo.listOwnerUsers(query.parseUserListQuery(filter ? { filter } : {}), NOW);
    const all = await list();
    expect(all.counts.all).toBe(63);
    expect(all.total).toBe(63);

    const fresh = await list("new");
    expect(fresh.rows.map((row) => row.userId).sort()).toEqual([WEB_USER, 8001].sort());
    expect(fresh.counts.new).toBe(2);

    const ext = await list("ext");
    expect(ext.rows.map((row) => row.userId)).toEqual([8001]);

    const unfilled = await list("unfilled");
    expect(unfilled.total).toBe(61); // все, кроме 8001 и 8002 (8003 начал, но не закончил)
    expect(unfilled.counts.unfilled).toBe(61);
    const started = await repo.listOwnerUsers(query.parseUserListQuery({ filter: "unfilled", q: "@stud3" }), NOW);
    expect(started.rows.map((row) => row.userId)).toContain(8003);

    // Неактивны: регистрация и все отметки старше 30 дней. Владелец заходил (сессия сайта) — активен.
    const idle = await list("inactive");
    const idle2 = await repo.listOwnerUsers(query.parseUserListQuery({ filter: "inactive", page: "2" }), NOW);
    const idleIds = [...idle.rows, ...idle2.rows].map((row) => row.userId);
    expect(idleIds).toHaveLength(idle.total);
    expect(idleIds).toContain(8004);
    expect(idleIds).toContain(8050);
    for (const active of [OWNER, 8001, 8002, 8003, WEB_USER]) expect(idleIds).not.toContain(active);
  });

  it("сортировка и страницы: порядок полный, страницы не пересекаются", async () => {
    const { repo, query } = await mods();
    const page1 = await repo.listOwnerUsers(query.parseUserListQuery({}), NOW);
    const page2 = await repo.listOwnerUsers(query.parseUserListQuery({ page: "2" }), NOW);
    expect(page1.rows).toHaveLength(query.PAGE_SIZE);
    expect(page2.rows).toHaveLength(63 - query.PAGE_SIZE);
    const ids = new Set([...page1.rows, ...page2.rows].map((row) => row.userId));
    expect(ids.size).toBe(63);
    // По регистрации, свежие первыми.
    const created = page1.rows.map((row) => row.createdAt.getTime());
    expect(created).toEqual([...created].sort((a, b) => b - a));

    const byGroups = await repo.listOwnerUsers(query.parseUserListQuery({ sort: "groups" }), NOW);
    expect(byGroups.rows.slice(0, 2).map((row) => row.userId).sort()).toEqual([8001, 8002]);
    const byGroupsAsc = await repo.listOwnerUsers(query.parseUserListQuery({ sort: "groups", dir: "asc" }), NOW);
    expect(byGroupsAsc.rows[0].groups).toBe(0);

    const byActive = await repo.listOwnerUsers(query.parseUserListQuery({ sort: "active" }), NOW);
    const active = byActive.rows.map((row) => row.lastActive.getTime());
    expect(active).toEqual([...active].sort((a, b) => b - a));

    // Страница за концом — пусто, но общее число известно.
    const beyond = await repo.listOwnerUsers(query.parseUserListQuery({ page: "9" }), NOW);
    expect(beyond.rows).toEqual([]);
    expect(beyond.total).toBe(63);
  });
});

describe("карточка человека", () => {
  it("всё о человеке, но без секретов и текстов", async () => {
    const { repo } = await mods();
    const detail = (await repo.ownerUserDetail(8001, NOW))!;
    expect(detail.user).toMatchObject({ userId: 8001, filled: true, origin: "campus", extVersion: "0.3.0", hasPassword: false });
    expect(detail.user.calendar.connected).toBe(true);
    expect(detail.groups.map((group) => [group.slug, group.role, group.size, group.filled])).toEqual([
      ["grpone", "admin", 3, 2],
      ["grptwo", "member", 2, 2],
    ]);
    expect(detail.schedule).toMatchObject({ weekly: 1, soft: 1, fromCalendar: 1 });
    expect(detail.meetings).toMatchObject({ made: 1, madeUpcoming: 1, invited: 1, asked: 1, attended: 1 });
    expect(detail.meetings.answers).toEqual({ yes: 0, no: 0, change: 1 });

    const text = JSON.stringify(detail);
    for (const secret of ["secret-feed-token", "calendar.example", "секретная цель", "секретный комментарий", "scrypt"]) {
      expect(text).not.toContain(secret);
    }
    expect(text).not.toMatch(/[0-9a-f]{64}/);
  });

  it("сессии, уведомления вместо бота, пароль; несуществующий — null", async () => {
    const { repo } = await mods();
    const third = (await repo.ownerUserDetail(8003, NOW))!;
    expect(third.sessions.count).toBe(1);
    expect(third.notices).toMatchObject({ total: 1, unread: 1 });
    expect((await repo.ownerUserDetail(8002, NOW))!.user.hasPassword).toBe(true);
    expect(await repo.ownerUserDetail(123, NOW)).toBeNull();
  });
});

describe("группы", () => {
  it("список: размер, заполненность, встречи, фильтры и поиск", async () => {
    const { repo, query } = await mods();
    const all = await repo.listOwnerGroups(query.parseGroupListQuery({ sort: "size" }), NOW);
    expect(all.rows.map((row) => row.slug)).toEqual(["grpone", "grptwo", "lonely"]);
    expect(all.rows[0]).toMatchObject({ size: 3, filled: 2, meetings: 2, upcoming: 2, origin: "web" });
    expect(all.counts).toEqual({ all: 3, telegram: 1, web: 2, live: 2, small: 1 });
    const live = await repo.listOwnerGroups(query.parseGroupListQuery({ filter: "live" }), NOW);
    expect(live.rows.map((row) => row.slug).sort()).toEqual(["grpone", "grptwo"]);
    expect((await repo.listOwnerGroups(query.parseGroupListQuery({ q: "-503" }), NOW)).rows.map((row) => row.slug)).toEqual(["lonely"]);
    expect((await repo.listOwnerGroups(query.parseGroupListQuery({ q: "ВТОР" }), NOW)).rows.map((row) => row.slug)).toEqual(["grptwo"]);
  });

  it("карточка группы: участники и числа встреч без текстов", async () => {
    const { repo } = await mods();
    const detail = (await repo.ownerGroupDetail(-501, NOW))!;
    expect(detail.members.map((member) => member.userId)).toEqual([8001, 8002, 8003]);
    expect(detail.meetings).toMatchObject({ recurring: 1, withSummary: 1, responses: 2, asked: 1, attended: 1 });
    expect(JSON.stringify(detail)).not.toContain("секрет");
    expect(await repo.ownerGroupDetail(-999, NOW)).toBeNull();
  });
});

describe("«Обзор»: воронка, когорты, функции", () => {
  it("воронка вложенная, языки, функции, охват бота", async () => {
    const { repo } = await mods();
    const insights = await repo.ownerInsights(NOW);
    expect(insights.funnel).toEqual({ registered: 63, joined: 4, filled: 2, engaged: 2 });
    expect(insights.langs.find((item) => item.lang === "kk")?.count).toBe(31);
    expect(insights.features).toMatchObject({ photo: 1, campus: 1, calendar: 1, avatars: 1, passwords: 1, soft: 1, recurringMeetings: 1 });
    expect(insights.bot).toMatchObject({ web: 1, unreachable: 1 });
    expect(insights.topGroups[0]).toMatchObject({ chatId: -501 });
    expect(insights.groupsByDay.reduce((sum, point) => sum + point.count, 0)).toBe(3);
    const cohortSum = insights.cohorts.reduce((sum, cohort) => sum + cohort.size, 0);
    // В 8 недель попали только 8001 (вчера) и веб-аккаунт (2 дня назад): остальные старше.
    expect(cohortSum).toBe(2);
    expect(insights.cohorts.at(-1)!.active[0]).toBeGreaterThanOrEqual(1);
    for (const cohort of insights.cohorts) expect(cohort.active).toHaveLength(repo.COHORT_WEEKS);
  });

  it("сколько недель прожила когорта", async () => {
    const { repo } = await mods();
    const now = new Date("2026-10-09T10:00:00Z"); // четверг
    expect(repo.cohortWeeksElapsed("2026-10-05", now)).toBe(1);
    expect(repo.cohortWeeksElapsed("2026-09-28", now)).toBe(2);
    expect(repo.cohortWeeksElapsed("2026-08-17", now)).toBe(8);
  });
});

describe("гейт всех страниц консоли", () => {
  const PAGES = [
    ["@/app/admin/page", {}],
    ["@/app/admin/users/page", {}],
    ["@/app/admin/users/[id]/page", { id: "8001" }],
    ["@/app/admin/groups/page", {}],
    ["@/app/admin/groups/[id]/page", { id: "-501" }],
    ["@/app/admin/system/page", {}],
  ] as const;

  async function render(path: string, params: Record<string, string>, search: Record<string, string> = {}) {
    const mod = (await import(/* @vite-ignore */ path)) as {
      default: (props: { params: Promise<Record<string, string>>; searchParams: Promise<Record<string, string>> }) => Promise<unknown>;
    };
    return mod.default({ params: Promise.resolve(params), searchParams: Promise.resolve(search) });
  }

  async function views(): Promise<{ event: string; target_id: string | number | null }[]> {
    const result = await db.query<{ event: string; target_id: string | number | null }>(
      "select event, target_id from owner_audit where event in ('user_view', 'group_view') order by id",
    );
    return result.rows;
  }

  it("каждая страница /admin — через ownerPage и общий гейт", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? walk(join(dir, entry.name)) : entry.name === "page.tsx" ? [join(dir, entry.name)] : [],
      );
    const pages = walk("src/app/admin");
    expect(pages.length).toBe(PAGES.length + 1); // + старый адрес /admin/stats
    for (const file of pages) {
      const source = readFileSync(file, "utf8");
      if (file.includes("stats")) expect(source).toContain("ownerViewer()");
      else expect(source, file).toMatch(/export default ownerPage\(/);
    }
  });

  it("не вошёл, вошёл не владельцем — «не найдено» на всех страницах, ничего не прочитано и не записано", async () => {
    for (const [path, params] of PAGES) {
      jar.clear();
      await expect(render(path, params), path).rejects.toThrow("NEXT_NOT_FOUND");
      jar.set("qairu_token", outsiderWeb);
      jar.set("qairu_owner", ownerConsole); // чужая кука консоли не помогает
      await expect(render(path, params), path).rejects.toThrow("NEXT_NOT_FOUND");
    }
    expect(await views()).toEqual([]);
  });

  it("пустые ALERT_CHAT_ID и OWNER_IDS — владельцев нет, всем 404", async () => {
    process.env.ALERT_CHAT_ID = "";
    process.env.OWNER_IDS = " , ";
    jar.set("qairu_token", ownerWeb);
    jar.set("qairu_owner", ownerConsole);
    for (const [path, params] of PAGES) await expect(render(path, params), path).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("владелец без открытой консоли — только форма кода: данные не читаются, журнал пуст", async () => {
    const { ownerAccess } = await import("@/lib/ownerGate");
    jar.set("qairu_token", ownerWeb);
    expect((await ownerAccess()).session).toBeNull();
    for (const [path, params] of PAGES) {
      // Несуществующий id не роняет страницу в 404 раньше времени: до тела страницы дело не доходит.
      await expect(render(path, "id" in params ? { id: "123" } : params), path).resolves.toBeTruthy();
    }
    expect(await views()).toEqual([]);
  });

  it("владелец с консолью: карточки открываются и пишутся в журнал; чужой id — 404", async () => {
    const { ownerAccess } = await import("@/lib/ownerGate");
    jar.set("qairu_token", ownerWeb);
    jar.set("qairu_owner", ownerConsole);
    expect((await ownerAccess()).session).not.toBeNull();
    // Пустой DEFAULT_TZ (как в Vercel) не роняет ни одну страницу.
    process.env.DEFAULT_TZ = "";
    for (const [path, params] of PAGES) await expect(render(path, params, { q: "Студент", page: "2" }), path).resolves.toBeTruthy();
    process.env.DEFAULT_TZ = "Mars/Olympus";
    await expect(render("@/app/admin/page", {})).resolves.toBeTruthy();

    expect((await views()).map((row) => [row.event, Number(row.target_id)])).toEqual([
      ["user_view", 8001],
      ["group_view", -501],
    ]);
    const { repo } = await mods();
    const recent = await repo.recentOwnerViews(5);
    expect(recent[0]).toMatchObject({ event: "group_view", targetId: -501, name: "Первая группа" });
    expect(recent[1]).toMatchObject({ event: "user_view", targetId: 8001, name: "Студент 1" });
    // Просмотры не попадают в журнал входов.
    expect((await repo.recentOwnerEvents(50)).some((event) => event.event.endsWith("_view"))).toBe(false);

    await expect(render("@/app/admin/users/[id]/page", { id: "123" })).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(render("@/app/admin/users/[id]/page", { id: "abc" })).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(render("@/app/admin/groups/[id]/page", { id: "-999" })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(await views()).toHaveLength(2);
  });

  it("сессия консоли от другой сессии сайта не открывает данные", async () => {
    const { repo } = await mods();
    const { ownerAccess } = await import("@/lib/ownerGate");
    jar.set("qairu_token", await repo.issueWebSession(OWNER));
    jar.set("qairu_owner", ownerConsole);
    expect((await ownerAccess()).session).toBeNull();
  });
});
