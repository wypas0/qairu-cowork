import type { translator } from "@/i18n";

/** Исходы, о которых говорим спокойным тостом; остальные — тостом ошибки. */
const GOOD = new Set([
  "sent",
  "asked",
  "friends_now",
  "accepted",
  "declined",
  "cancelled",
  "removed",
  "blocked_done",
  "unblocked",
  "rotated",
  "already",
  "saved",
  "invited",
  "invited_many",
  "joined",
  "approved",
  "restored",
  "meeting_sent",
  "meeting_site",
  "answered",
  "meeting_cancelled",
  "pinged",
  "ping_site",
]);

/**
 * Итог действия с друзьями (`?fr=<код>`, см. friends/actions) — текстом для
 * тоста. Незнакомый код молча пропускается: параметр в адресе мог прийти откуда угодно.
 */
export function friendFlash(t: ReturnType<typeof translator>, code: unknown): { message: string | null; tone: "ok" | "error" } {
  if (typeof code !== "string" || !/^[a-z_]{2,24}$/.test(code)) return { message: null, tone: "ok" };
  const key = `w_fr_flash_${code}`;
  const text = t(key);
  return text === key ? { message: null, tone: "ok" } : { message: text, tone: GOOD.has(code) ? "ok" : "error" };
}
