/**
 * Подписка на личный календарь: скачать .ics по ссылке и превратить в
 * занятость на ближайшие недели.
 *
 * Ссылку вводит человек, а скачивает сервер, — значит, её нельзя пускать во
 * внутреннюю сеть (SSRF): адрес и каждая переадресация проверяются, что
 * ведут в публичный интернет. Размер и время ответа ограничены.
 */

import "server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { busyFromIcs, looksLikeIcs } from "@/core/ics";
import { type DateStr, DEFAULT_TZ, addDays, chatTz, todayIn } from "@/core/timeutils";
import * as repo from "@/db/repo";
import { checkConflictsQuietly } from "./conflicts";

export type CalendarError = "bad_url" | "blocked" | "unreachable" | "not_ics" | "too_large";

/** Насколько вперёд берём занятость — как далеко листается карта группы. */
const WEEKS_AHEAD = 9;
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
/** Календарь обновляется не чаще, чем раз в столько часов (cron). */
export const REFRESH_HOURS = 3;

/**
 * Привести ссылку к виду, который можно скачать: webcal:// — это тот же
 * https://. Отвергаются не-http(s), логин в ссылке и адреса без домена.
 */
export function normalizeCalendarUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2000) return null;
  const withScheme = trimmed.replace(/^webcals?:\/\//i, "https://");
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  if (!url.hostname.includes(".") && isIP(url.hostname) === 0) return null;
  return url.toString();
}

/** Адрес внутренней сети, куда серверу ходить нельзя. */
export function isPrivateAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, "").toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped) return isPrivateAddress(mapped[1]);
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (isIP(ip) === 6) {
    return ip === "::" || ip === "::1" || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip);
  }
  return true;
}

async function publicHost(hostname: string): Promise<boolean> {
  if (isIP(hostname.replace(/^\[|\]$/g, "")) !== 0) return !isPrivateAddress(hostname);
  try {
    const addresses = await lookup(hostname, { all: true });
    return addresses.length > 0 && addresses.every((entry) => !isPrivateAddress(entry.address));
  } catch {
    return false;
  }
}

/** Скачать календарь по ссылке, следуя переадресациям вручную (каждую проверяем). */
export async function fetchCalendar(
  rawUrl: string,
): Promise<{ ok: true; text: string } | { ok: false; error: CalendarError }> {
  const first = normalizeCalendarUrl(rawUrl);
  if (!first) return { ok: false, error: "bad_url" };
  let url: string = first;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const target = new URL(url);
    if (!(await publicHost(target.hostname))) return { ok: false, error: "blocked" };
    let response: Response;
    try {
      response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: "text/calendar, text/plain;q=0.9, */*;q=0.5", "user-agent": "QairuCowork calendar sync" },
      });
    } catch {
      return { ok: false, error: "unreachable" };
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      const next: string | null = location ? normalizeCalendarUrl(new URL(location, url).toString()) : null;
      if (!next) return { ok: false, error: "unreachable" };
      url = next;
      continue;
    }
    if (!response.ok || !response.body) return { ok: false, error: "unreachable" };

    // Читаем по кусочкам: огромный ответ обрываем, не дожидаясь конца.
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel().catch(() => {});
        return { ok: false, error: "too_large" };
      }
      chunks.push(value);
    }
    const text = new TextDecoder("utf-8").decode(Buffer.concat(chunks));
    return looksLikeIcs(text) ? { ok: true, text } : { ok: false, error: "not_ics" };
  }
  return { ok: false, error: "unreachable" };
}

/** Пояс, в котором раскладывать занятость человека: его последней группы. */
async function userTz(userId: number): Promise<string> {
  const chats = await repo.userChats(userId);
  return chats.length > 0 ? chatTz(chats[0]) : DEFAULT_TZ;
}

/**
 * Скачать и разложить календарь человека. При ошибке прежняя занятость
 * остаётся: устаревший календарь лучше, чем внезапно «свободен весь месяц».
 */
export async function syncCalendar(
  userId: number,
  url: string,
): Promise<{ ok: true; count: number } | { ok: false; error: CalendarError }> {
  const fetched = await fetchCalendar(url);
  if (!fetched.ok) {
    // Время попытки тоже отмечаем: иначе cron дёргал бы битую ссылку каждые
    // 10 минут. На странице при ошибке показывается она, а не «обновлён».
    await repo.setCalendarStatus(userId, { syncedAt: new Date(), error: fetched.error });
    return fetched;
  }
  const tz = await userTz(userId);
  const today: DateStr = todayIn(tz);
  const pieces = busyFromIcs(fetched.text, tz, addDays(today, -1), addDays(today, WEEKS_AHEAD * 7));
  await repo.replaceCalendarSlots(userId, pieces);
  await repo.setCalendarStatus(userId, { syncedAt: new Date(), error: null });
  return { ok: true, count: pieces.length };
}

/** Для cron: обновить несколько давно не обновлявшихся календарей, уложившись во время. */
export async function syncStaleCalendars(limit: number, budgetMs: number): Promise<number> {
  const started = Date.now();
  const before = new Date(Date.now() - REFRESH_HOURS * 3_600_000);
  let synced = 0;
  for (const { userId, calendarUrl } of await repo.staleCalendars(before, limit)) {
    if (Date.now() - started > budgetMs) break;
    const result = await syncCalendar(userId, calendarUrl);
    if (!result.ok) continue;
    synced += 1;
    // В календаре появилось новое событие — не легло ли оно на встречу.
    await checkConflictsQuietly(userId);
  }
  return synced;
}
