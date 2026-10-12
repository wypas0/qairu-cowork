/**
 * Проверка здоровья для `/api/healthz`: жив ли сайт и отвечает ли база.
 *
 * Адрес публичный и его опрашивают мониторы (UptimeRobot раз в 5 минут,
 * проверка после деплоя в GitHub Actions), поэтому ответ — только «да/нет»,
 * время запроса и версия кода: ни текста ошибки, ни адреса базы, ни счётчиков.
 * Причина падения — в журнале Vercel строкой `[qairu:healthz]`.
 */

import "server-only";

import { sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import { env } from "./config";

/** Сколько ждём базу. Холодный старт с пулером Supabase — доли секунды, 2,5 с — с запасом. */
export const DB_TIMEOUT_MS = 2_500;

export type DbHealth = { ok: boolean; ms: number; error?: "timeout" | "unavailable" };

export type Health = {
  ok: boolean;
  /** null — база не проверялась (быстрый режим `?live`). */
  db: DbHealth | null;
  /** Короткий хеш коммита на Vercel, локально — null. */
  version: string | null;
  at: string;
};

/** Самый дешёвый запрос, который всё равно проходит через пулер до базы. */
async function pingDb(): Promise<void> {
  await getDb().execute(sql`select 1`);
}

export async function checkDb(ping: () => Promise<unknown> = pingDb, timeoutMs = DB_TIMEOUT_MS): Promise<DbHealth> {
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  try {
    // Запрос, не уложившийся в срок, не отменяется — его доведёт или оборвёт драйвер.
    const outcome = await Promise.race([Promise.resolve().then(ping), timeout]);
    const ms = Date.now() - startedAt;
    if (outcome === "timeout") {
      console.error(`[qairu:healthz] база не ответила за ${timeoutMs} мс`);
      return { ok: false, ms, error: "timeout" };
    }
    return { ok: true, ms };
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0]!.slice(0, 200) : String(error);
    console.error(`[qairu:healthz] база недоступна: ${message}`);
    return { ok: false, ms: Date.now() - startedAt, error: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkHealth(options: { db?: boolean } = {}): Promise<Health> {
  const db = options.db === false ? null : await checkDb();
  return {
    ok: db ? db.ok : true,
    db,
    version: env("VERCEL_GIT_COMMIT_SHA")?.slice(0, 7) ?? null,
    at: new Date().toISOString(),
  };
}
