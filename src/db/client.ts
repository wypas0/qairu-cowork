/**
 * Подключение к Postgres.
 *
 * Соединение создаётся лениво: `next build` импортирует эти модули, чтобы
 * собрать страницы, и падать там из-за отсутствующего DATABASE_URL незачем —
 * ошибка должна возникать в рантайме того запроса, которому база и правда нужна.
 *
 * Настройки драйвера подобраны под пулер Supabase (порт 6543):
 * `prepare: false` обязателен — transaction mode не поддерживает
 * prepared statements, и без него первый же повторный запрос падает.
 */

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type Sql = ReturnType<typeof postgres>;

const globalForDb = globalThis as unknown as {
  __qairuSql?: Sql;
  __qairuDb?: PostgresJsDatabase<typeof schema>;
};

function createSql(): Sql {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL не задан. Возьми строку подключения в Supabase → Project Settings → " +
        "Database → Connection pooling (Transaction) и положи её в переменные окружения.",
    );
  }
  return postgres(url, {
    // Одна лямбда — одно соединение: пулер Supabase и так держит их за нас.
    max: 1,
    idle_timeout: 20,
    connect_timeout: 15,
    prepare: false,
  });
}

export function getDb(): PostgresJsDatabase<typeof schema> {
  if (globalForDb.__qairuDb) return globalForDb.__qairuDb;
  const sql = globalForDb.__qairuSql ?? createSql();
  const db = drizzle(sql, { schema });
  globalForDb.__qairuSql = sql;
  globalForDb.__qairuDb = db;
  return db;
}

export type Db = PostgresJsDatabase<typeof schema>;
