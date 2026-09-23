import type { RU } from "./ru";

/** Плоский словарь строк одного языка. */
export type Strings = Record<string, string>;

/**
 * Словарь казахского и английского: ровно те же ключи, что в русском.
 * Пропущенная строка — ошибка компиляции, а не тихий откат на русский.
 */
export type Dict = { [K in keyof typeof RU]: string };
