import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

import { expectedSchema, migrationFiles, missingColumns } from "../scripts/check-schema.mjs";
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
