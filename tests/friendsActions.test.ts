/**
 * Действия раздела «Друзья» — как их вызывает форма: кука сессии, заголовки
 * запроса и возврат редиректом (next/headers и next/navigation подменены).
 * Здесь — то, что сервис сам не видит: вход, источник запроса и то, что
 * форма может прислать чужие id.
 */

import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { startTestDb } from "./support/db";

const jar = new Map<string, string>();
let requestHeaders = new Headers();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => jar.set(name, value),
    delete: (name: string) => jar.delete(name),
  }),
  headers: async () => requestHeaders,
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

const ME = 7101;
const OTHER = 7102;
const STRANGER = 7103;

let db: PGlite;

async function actions() {
  return import("@/app/friends/actions");
}

/** Вызвать действие и вернуть, куда оно перенаправило. */
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

function form(fields: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(name, item);
  }
  return data;
}

beforeAll(async () => {
  db = await startTestDb();
  await db.exec(`
    insert into users (user_id, username, full_name) values
      (${ME}, 'act_me', 'Я'), (${OTHER}, 'act_other', 'Другой'), (${STRANGER}, 'act_stranger', 'Чужой');
    insert into chats (chat_id, slug, origin, title) values (-7101, 'actmine', 'web', 'Моя'), (-7102, 'actother', 'web', 'Чужая');
    insert into memberships (chat_id, user_id) values (-7101, ${ME}), (-7102, ${STRANGER});
  `);
  const repo = await import("@/db/repo");
  jar.set("qairu_token", await repo.issueWebSession(ME));
});

beforeEach(() => {
  requestHeaders = new Headers({ "sec-fetch-site": "same-origin" });
});

describe("действия друзей", () => {
  it("без входа — на вход через Telegram", async () => {
    const token = jar.get("qairu_token")!;
    jar.delete("qairu_token");
    const { requestFriendAction } = await actions();
    expect(await redirectOf(() => requestFriendAction(form({ username: "act_other" })))).toMatch(/^\/login\?next=/);
    jar.set("qairu_token", token);
  });

  it("запрос с чужого сайта отклоняется до любых изменений", async () => {
    requestHeaders = new Headers({ "sec-fetch-site": "cross-site" });
    const { requestFriendAction } = await actions();
    expect(await redirectOf(() => requestFriendAction(form({ username: "act_other" })))).toBe("/friends?fr=origin");
    const rows = await db.query("select 1 from friend_requests where from_user = $1", [ME]);
    expect(rows.rows).toEqual([]);
  });

  it("со своей страницы — заявка уходит, возврат только на наши страницы", async () => {
    const { requestFriendAction } = await actions();
    const to = await redirectOf(() =>
      requestFriendAction(form({ username: "act_other", next: "https://evil.example/steal" })),
    );
    expect(to).toBe("/friends?fr=sent");
    const rows = await db.query<{ to_user: number }>("select to_user from friend_requests where from_user = $1", [ME]);
    expect(rows.rows.map((row) => Number(row.to_user))).toEqual([OTHER]);
  });

  it("скрыть можно только свою группу: чужой id из формы ничего не меняет", async () => {
    const { saveFriendSettingsAction } = await actions();
    const to = await redirectOf(() =>
      saveFriendSettingsAction(form({ friends_see_groups: "on", hidden: ["-7101", "-7102"] })),
    );
    expect(to).toBe("/friends?tab=privacy&fr=saved");
    const rows = await db.query<{ chat_id: number; user_id: number; hidden_from_friends: boolean }>(
      "select chat_id, user_id, hidden_from_friends from memberships order by chat_id",
    );
    expect(rows.rows.map((row) => [Number(row.chat_id), Number(row.user_id), row.hidden_from_friends])).toEqual([
      [-7102, STRANGER, false],
      [-7101, ME, true],
    ]);
    // Не отмеченное «находить по нику» выключилось, «группы видны» — осталось.
    const me = await db.query<{ findable: boolean; friends_see_groups: boolean }>(
      "select findable, friends_see_groups from users where user_id = $1",
      [ME],
    );
    expect(me.rows[0]).toEqual({ findable: false, friends_see_groups: true });
  });

  it("позвать в чужую группу нельзя, даже друга", async () => {
    const repo = await import("@/db/repo");
    await repo.addFriendship(ME, OTHER);
    const { inviteFriendsAction } = await actions();
    const to = await redirectOf(() => inviteFriendsAction(form({ chat: "-7102", friend: String(OTHER) })));
    expect(to).toBe("/friends?fr=not_member");
    expect((await db.query("select 1 from group_invites")).rows).toEqual([]);
  });
});
