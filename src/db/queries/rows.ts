/**
 * Разбор ответа сырого SQL для консоли владельца. Не попадает в repo: это
 * не запросы, а мелочь, общая для queries/stats, insights и ownerUsers.
 */

import "server-only";

export type Row = Record<string, unknown>;

/** postgres.js отдаёт строки массивом, PGlite (тесты) — в поле rows. */
export function rowsOf(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  return ((result as { rows?: Row[] }).rows ?? []) as Row[];
}

export const num = (value: unknown): number => Number(value ?? 0) || 0;

export const list = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

/** Момент из json_agg (строка с поясом) или из колонки (Date); пусто — null. */
export function dateOrNull(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Поиск подстроки в ILIKE: `%`, `_` и `\` в запросе — обычные буквы, а не
 * шаблон. Обратная косая — экранирующий знак LIKE по умолчанию.
 */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}
