import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

import {
  RLS_QUERY,
  expectedRls,
  expectedSchema,
  migrationFiles,
  missingColumns,
  missingRls,
} from "../scripts/check-schema.mjs";
import { applyMigrations } from "./support/db";

async function columnsOf(client: PGlite) {
  const result = await client.query<{ table_name: string; column_name: string }>(
    "select table_name, column_name from information_schema.columns where table_schema = 'public'",
  );
  return result.rows;
}

describe("проверка схемы перед сборкой", () => {
  it("знает колонки из CREATE TABLE и из ALTER TABLE … ADD COLUMN", async () => {
    const expected = expectedSchema(await migrationFiles());
    expect(expected.get("busy_slots")?.get("start_min")).toBe("0000_init.sql");
    expect(expected.get("meetings")?.get("repeat_until")).toBe("0004_recurring_meetings.sql");
  });

  it("после всех миграций ничего не упущено", async () => {
    const client = new PGlite();
    await applyMigrations(client);
    expect(missingColumns(expectedSchema(await migrationFiles()), await columnsOf(client))).toEqual([]);
    await client.close();
  });

  it("называет файл, который забыли выполнить", async () => {
    const client = new PGlite();
    await applyMigrations(client);
    await client.exec('ALTER TABLE "meetings" DROP COLUMN "repeat_until"');
    const missing = missingColumns(expectedSchema(await migrationFiles()), await columnsOf(client));
    expect(missing).toEqual([{ file: "0004_recurring_meetings.sql", table: "meetings", column: "repeat_until" }]);
    await client.close();
  });
});

async function rlsOf(client: PGlite) {
  return (await client.query<{ relname: string; relrowsecurity: boolean }>(RLS_QUERY)).rows;
}

describe("RLS", () => {
  it("все таблицы под RLS", async () => {
    const client = new PGlite();
    await applyMigrations(client);
    const rows = await rlsOf(client);
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.filter((row) => !row.relrowsecurity).map((row) => row.relname)).toEqual([]);
    await client.close();
  });

  it("владелец таблиц (так ходит сайт) видит строки, роль Data API — ни одной", async () => {
    const client = new PGlite();
    await applyMigrations(client);
    await client.exec(`
      INSERT INTO users (user_id, full_name) VALUES (4242, 'Под RLS');
      CREATE ROLE site_owner NOLOGIN;
      CREATE ROLE anon NOLOGIN;
      ALTER TABLE users OWNER TO site_owner;
      GRANT SELECT ON users TO anon;
    `);
    const count = async () => (await client.query<{ n: number }>("select count(*)::int as n from users")).rows[0].n;
    await client.exec("SET ROLE site_owner");
    expect(await count()).toBe(1);
    await client.exec("RESET ROLE; SET ROLE anon");
    expect(await count()).toBe(0);
    await client.close();
  });

  it("проверка перед сборкой называет миграцию, если RLS не включён", async () => {
    const client = new PGlite();
    await applyMigrations(client);
    const expected = expectedRls(await migrationFiles());
    expect(missingRls(expected, await rlsOf(client))).toEqual([]);

    await client.exec('ALTER TABLE "web_sessions" DISABLE ROW LEVEL SECURITY');
    expect(missingRls(expected, await rlsOf(client))).toEqual([
      { file: "0007_row_level_security.sql", table: "web_sessions" },
    ]);
    await client.close();
  });
});
