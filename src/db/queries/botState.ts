/** Состояние диалогов бота. */

import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { botState } from "../schema";
import { type Exec, ex } from "./base";

// --------------------------------------------------------------------------
// Состояние диалогов бота
// --------------------------------------------------------------------------

export async function getBotState<T>(key: string, exec?: Exec): Promise<T | null> {
  const [row] = await ex(exec)
    .select({ data: botState.data })
    .from(botState)
    .where(eq(botState.key, key))
    .limit(1);
  return (row?.data as T) ?? null;
}

export async function setBotState(key: string, data: unknown, exec?: Exec): Promise<void> {
  await ex(exec)
    .insert(botState)
    .values({ key, data: data as object, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: botState.key,
      set: { data: data as object, updatedAt: new Date() },
    });
}

export async function deleteBotState(key: string, exec?: Exec): Promise<void> {
  await ex(exec).delete(botState).where(eq(botState.key, key));
}

/**
 * Забрать запись и удалить её одной инструкцией. Из нескольких одновременных
 * вызовов данные получит ровно один — остальные увидят null. Нужно для
 * одноразовых запросов входа: два параллельных опроса не должны выдать две сессии.
 */
export async function takeBotState<T>(key: string, exec?: Exec): Promise<T | null> {
  const [row] = await ex(exec)
    .delete(botState)
    .where(eq(botState.key, key))
    .returning({ data: botState.data });
  return (row?.data as T) ?? null;
}

/** Удалить записи с префиксом, не обновлявшиеся с `before` — уборка протухших запросов. */
export async function deleteStaleBotState(prefix: string, before: Date, exec?: Exec): Promise<void> {
  await ex(exec)
    .delete(botState)
    .where(
      and(
        sql`${botState.key} like ${`${prefix.replace(/[%_\\]/g, "\\$&")}%`}`,
        sql`${botState.updatedAt} < ${before.toISOString()}::timestamptz`,
      ),
    );
}
