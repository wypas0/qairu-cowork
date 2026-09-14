/**
 * Настоящий Postgres в процессе теста.
 *
 * PGlite поднимает тот же движок, что и Supabase, и мы накатываем на него те
 * же файлы миграций, которые поедут в продакшен, — все по порядку номеров.
 * Синглтон подменяется до первого импорта `@/db/repo` — `getDb()` читает
 * именно `globalThis.__qairuDb`.
 */

import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

import * as schema from "@/db/schema";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../drizzle/", import.meta.url));

/** Накатить все `drizzle/NNNN_*.sql` в порядке номеров. */
export async function applyMigrations(client: PGlite): Promise<void> {
  const files = (await readdir(MIGRATIONS_DIR)).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
  for (const file of files) {
    const migration = await readFile(`${MIGRATIONS_DIR}${file}`, "utf8");
    for (const statement of migration.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) await client.exec(trimmed);
    }
  }
}

export async function startTestDb(): Promise<PGlite> {
  const client = new PGlite();
  const globalForDb = globalThis as unknown as { __qairuDb?: unknown };
  globalForDb.__qairuDb = drizzle(client, { schema });
  await applyMigrations(client);
  return client;
}
