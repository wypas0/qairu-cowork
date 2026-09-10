/**
 * Настоящий Postgres в процессе теста.
 *
 * PGlite поднимает тот же движок, что и Supabase, и мы накатываем на него тот
 * же файл миграции, который поедет в продакшен. Синглтон подменяется до первого
 * импорта `@/db/repo` — `getDb()` читает именно `globalThis.__qairuDb`.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

import * as schema from "@/db/schema";

export async function startTestDb(): Promise<void> {
  const client = new PGlite();
  const globalForDb = globalThis as unknown as { __qairuDb?: unknown };
  globalForDb.__qairuDb = drizzle(client, { schema });

  const sqlPath = fileURLToPath(new URL("../../drizzle/0000_init.sql", import.meta.url));
  const migration = await readFile(sqlPath, "utf8");
  for (const statement of migration.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed) await client.exec(trimmed);
  }
}
