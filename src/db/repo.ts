/**
 * Слой доступа к данным. Все запросы к БД живут здесь.
 *
 * Каждая функция принимает необязательный исполнитель `exec`: без него берётся
 * общее соединение, с ним — транзакция. Так вызывающий код может собрать
 * несколько записей в одну атомарную операцию, не протаскивая соединение
 * через все слои.
 *
 * Запросы разложены по темам в `queries/`; этот файл — единая точка входа:
 * везде пишут `import * as repo from "@/db/repo"`.
 */

import "server-only";

export { type Exec, transaction } from "./queries/base";
export * from "./queries/groups";
export * from "./queries/schedule";
export * from "./queries/calendar";
export * from "./queries/meetings";
export * from "./queries/web";
export * from "./queries/credentials";
export * from "./queries/avatars";
export * from "./queries/notices";
export * from "./queries/botState";
export * from "./queries/merge";
