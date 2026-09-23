/**
 * Проверка перед сборкой: все ли миграции из drizzle/ выполнены в базе.
 *
 * Vercel миграции не накатывает — SQL выполняют руками в Supabase. Если код
 * с новой колонкой уедет на прод раньше SQL, упадут страницы, которые её
 * читают. Здесь то же самое ловится на сборке: она падает с понятным
 * сообщением, а рабочая версия сайта остаётся прежней.
 *
 * Без DATABASE_URL проверка пропускается (локальная сборка, CI). Если база
 * недоступна, сборка не блокируется: это сетевая проблема, а не схема.
 */

import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const DIR = fileURLToPath(new URL("../drizzle/", import.meta.url));

function log(message) {
  console.log(`[qairu:schema] ${message}`);
}

/**
 * Что должно быть в базе после всех миграций: таблица → колонка → файл,
 * который её создал. Понимает то, что пишет drizzle-kit: CREATE TABLE,
 * ALTER TABLE … ADD COLUMN и … DROP COLUMN.
 */
export function expectedSchema(files) {
  const tables = new Map();
  const add = (table, column, file) => {
    if (!tables.has(table)) tables.set(table, new Map());
    tables.get(table).set(column, file);
  };
  for (const { name, sql } of files) {
    for (const match of sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)? "(\w+)" \(([\s\S]*?)\n\);/g)) {
      for (const column of match[2].matchAll(/^\s*"(\w+)"/gm)) add(match[1], column[1], name);
    }
    for (const match of sql.matchAll(/ALTER TABLE "(\w+)" ADD COLUMN(?: IF NOT EXISTS)? "(\w+)"/g)) {
      add(match[1], match[2], name);
    }
    for (const match of sql.matchAll(/ALTER TABLE "(\w+)" DROP COLUMN(?: IF EXISTS)? "(\w+)"/g)) {
      tables.get(match[1])?.delete(match[2]);
    }
  }
  return tables;
}

/** Чего не хватает: [{ file, table, column }] по строкам information_schema.columns. */
export function missingColumns(expected, rows) {
  const present = new Set(rows.map((row) => `${row.table_name}.${row.column_name}`));
  const missing = [];
  for (const [table, columns] of expected) {
    for (const [column, file] of columns) {
      if (!present.has(`${table}.${column}`)) missing.push({ file, table, column });
    }
  }
  return missing;
}

export async function migrationFiles() {
  const names = (await readdir(DIR)).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
  return Promise.all(names.map(async (name) => ({ name, sql: await readFile(`${DIR}${name}`, "utf8") })));
}

async function main() {
  const url = (process.env.DATABASE_URL ?? "").trim();
  if (!url) {
    log("DATABASE_URL не задан — проверка схемы пропущена");
    return;
  }

  const { default: postgres } = await import("postgres");
  const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 10, idle_timeout: 5 });
  let rows;
  try {
    rows = await sql`select table_name, column_name from information_schema.columns where table_schema = 'public'`;
  } catch (error) {
    log(`база недоступна (${error.message}) — проверка схемы пропущена`);
    return;
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }

  const missing = missingColumns(expectedSchema(await migrationFiles()), rows);
  if (missing.length === 0) {
    log("схема базы совпадает с миграциями");
    return;
  }

  const files = [...new Set(missing.map((item) => item.file))];
  console.error(`[qairu:schema] В базе не хватает: ${missing.map((item) => `${item.table}.${item.column}`).join(", ")}.`);
  console.error(`[qairu:schema] Выполни в Supabase → SQL Editor: ${files.map((file) => `drizzle/${file}`).join(", ")},`);
  console.error("[qairu:schema] затем пересобери проект (Redeploy). Сайт остаётся на прошлой версии.");
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
