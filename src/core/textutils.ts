/** Безопасная работа с текстом сообщений. */

export const TELEGRAM_LIMIT = 4096;

/**
 * Обрезать текст по границе строки, чтобы не разорвать HTML-теги Telegram.
 *
 * Лимит Telegram — 4096 символов. Длинный список окон легко его превышает,
 * и тогда сообщение просто не отправляется. Режем по последнему переводу
 * строки и честно дописываем, что показано не всё.
 */
export function clip(text: string, limit = 3900, note = ""): string {
  if (text.length <= limit) return text;
  let cut = text.lastIndexOf("\n", limit);
  if (cut < Math.floor(limit / 2)) cut = limit;
  const tail = note ? `\n\n${note}` : "\n\n…";
  return text.slice(0, cut).replace(/\s+$/u, "") + tail;
}

/** Экранирование под parse_mode=HTML Telegram (аналог `html.escape`). */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}
