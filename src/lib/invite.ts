/**
 * Код группы.
 *
 * Код — это её слаг: тот же набор символов, что и в ссылке-приглашении, так
 * что второй идентификатор заводить не нужно. Разница только в подаче: код
 * показываем заглавными и с пробелом посередине, потому что его диктуют вслух
 * и переписывают с доски, а ссылку — кидают в чат.
 */

/**
 * Символы для новых кодов: без 0/O, 1/l/I и u — их путают и на слух, и глазами.
 * Старые коды остаются рабочими: поиск идёт по точному совпадению.
 */
export const CODE_ALPHABET = "23456789abcdefghjkmnpqrstvwxyz";

/** Код для показа: «7KQ4 MZPD». */
export function formatCode(slug: string): string {
  const upper = slug.toUpperCase();
  return upper.length === 8 ? `${upper.slice(0, 4)} ${upper.slice(4)}` : upper;
}

/**
 * Код из того, что ввёл человек: полная ссылка, код с пробелами или дефисами,
 * набранный заглавными. Возвращает слаг или null, если это не похоже на код.
 */
export function normalizeCode(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const fromLink = /\/g\/([a-z0-9]{3,24})/i.exec(trimmed);
  const candidate = (fromLink ? fromLink[1] : trimmed).replace(/[\s_-]+/g, "").toLowerCase();
  return /^[a-z0-9]{3,24}$/.test(candidate) ? candidate : null;
}
