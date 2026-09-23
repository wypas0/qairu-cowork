/** Общее для всех запросов: исполнитель (соединение или транзакция). */

import "server-only";

import { type Db, getDb } from "../client";

type TxCallback = Parameters<Db["transaction"]>[0];
export type Exec = Db | Parameters<TxCallback>[0];

export function ex(exec?: Exec): Exec {
  return exec ?? getDb();
}

export async function transaction<T>(fn: (tx: Exec) => Promise<T>): Promise<T> {
  return getDb().transaction((tx) => fn(tx));
}
