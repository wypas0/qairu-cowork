/**
 * Создание встречи с сайта (ревью 16.11.2026, Р14): точное время из поля
 * `when` («2026-12-01T15:30|90») сохраняется, только если часы 0–23 и
 * минуты 0–59. Иначе остаётся текст, как при свободном вводе.
 *
 * Действие вызывается так же, как его вызывает форма: кука сессии и
 * перехваченный редирект (next/headers и next/navigation подменены).
 */

import { beforeAll, describe, expect, it, vi } from "vitest";

import { startTestDb } from "./support/db";

const jar = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => jar.set(name, value),
    delete: (name: string) => jar.delete(name),
  }),
  headers: async () => new Headers({ "sec-fetch-site": "same-origin" }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const ME = 7201;
const CHAT = -7201;
const SLUG = "mtgtime1";

async function redirectOf(run: () => Promise<void>): Promise<string> {
  try {
    await run();
  } catch (error) {
    const match = /^NEXT_REDIRECT (.+)$/.exec((error as Error).message);
    if (match) return match[1]!;
    throw error;
  }
  throw new Error("действие не перенаправило");
}

/** Создать встречу формой и вернуть то, что легло в базу. */
async function create(when: string) {
  const { createMeetingAction } = await import("@/app/g/[slug]/actions");
  const repo = await import("@/db/repo");
  const form = new FormData();
  form.set("place", "Библиотека");
  form.set("goal", "Проверка времени");
  form.set("when", when);
  const to = await redirectOf(() => createMeetingAction(SLUG, form));
  expect(to).toMatch(new RegExp(`^/g/${SLUG}\\?`));
  const meetings = await repo.chatMeetings(CHAT);
  return meetings.reduce((latest, meeting) => (meeting.id > latest.id ? meeting : latest));
}

beforeAll(async () => {
  delete process.env.BOT_TOKEN;
  const db = await startTestDb();
  await db.exec(`
    insert into users (user_id, username, full_name) values (${ME}, 'mtg_me', 'Я');
    insert into chats (chat_id, slug, origin, title, tz) values (${CHAT}, '${SLUG}', 'web', 'Время', 'Asia/Almaty');
    insert into memberships (chat_id, user_id) values (${CHAT}, ${ME});
  `);
  const repo = await import("@/db/repo");
  jar.set("qairu_token", await repo.issueWebSession(ME));
});

describe("время встречи с сайта (Р14)", () => {
  it("время из выбора на карте сохраняется точным", async () => {
    const meeting = await create("2026-12-01T15:30|90");
    expect(meeting.whenStart?.toISOString()).toBe("2026-12-01T10:30:00.000Z");
    expect(meeting.durationMin).toBe(90);
  });

  it.each(["00:00", "23:59"])("границы суток (%s) — тоже точное время", async (clock) => {
    const meeting = await create(`2026-12-01T${clock}|60`);
    expect(meeting.whenStart).not.toBeNull();
  });

  it.each([
    ["часы 25", "2026-12-01T25:00|90"],
    ["часы 24", "2026-12-01T24:00|90"],
    ["минуты 60", "2026-12-01T15:60|90"],
    ["минуты 75", "2026-12-01T09:75|90"],
    ["отрицательные часы", "2026-12-01T-1:30|90"],
    ["дробные часы", "2026-12-01T1.5:00|90"],
    ["пустое время", "2026-12-01T|90"],
  ])("%s — точное время не сохраняется, остаётся текст", async (_name, when) => {
    const meeting = await create(when);
    expect(meeting.whenStart).toBeNull();
    expect(meeting.durationMin).toBeNull();
    expect(meeting.whenText).toBe(when);
  });
});
