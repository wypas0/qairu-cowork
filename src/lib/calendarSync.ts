/**
 * Подписка на личный календарь: скачать .ics по ссылке и превратить в
 * занятость на ближайшие недели.
 *
 * Ссылку вводит человек, а скачивает сервер, — значит, её нельзя пускать во
 * внутреннюю сеть (SSRF): адрес и каждая переадресация проверяются, что
 * ведут в публичный интернет, причём ещё раз — в момент подключения сокета
 * (см. checkedLookup). Размер и время ответа ограничены.
 */

import "server-only";

import dns, { type LookupAddress, type LookupOptions } from "node:dns";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { Agent, fetch } from "undici";

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

/** IPv4 внутренней сети или служебный. */
function privateIpv4([a, b, c]: number[]): boolean {
  return (
    a === 0 || // «этот» узел
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local, метаданные облаков
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // служебные, TEST-NET-1
    (a === 192 && b === 88 && c === 99) || // ретранслятор 6to4
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // замеры производительности
    (a === 198 && b === 51 && c === 100) || // TEST-NET-2
    (a === 203 && b === 0 && c === 113) || // TEST-NET-3
    a >= 224 // multicast и зарезервированные
  );
}

/** Восемь 16-битных групп IPv6: «::» развёрнут, хвост вида a.b.c.d — тоже. */
function ipv6Groups(ip: string): number[] | null {
  let text = ip.replace(/%.*$/, "");
  const tail = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (tail) {
    const [a, b, c, d] = tail.slice(1).map(Number);
    text = `${text.slice(0, tail.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (fill < 0) return null;
  const groups = [...left, ...Array<string>(fill).fill("0"), ...right].map((part) =>
    /^[0-9a-f]{1,4}$/.test(part) ? parseInt(part, 16) : NaN,
  );
  return groups.length === 8 && groups.every(Number.isInteger) ? groups : null;
}

/** IPv4 из двух групп IPv6, начиная с `from`. */
function embeddedIpv4(groups: number[], from: number): number[] {
  return [groups[from] >> 8, groups[from] & 0xff, groups[from + 1] >> 8, groups[from + 1] & 0xff];
}

/**
 * Адрес внутренней сети или служебный — туда серверу ходить нельзя.
 *
 * IPv6 разбирается целиком: внутри него бывает спрятан IPv4 — «::ffff:7f00:1»
 * (так URL записывает ::ffff:127.0.0.1), «::127.0.0.1», NAT64 «64:ff9b::…»,
 * 6to4 «2002:…». Всё, что разобрать не удалось, считается закрытым.
 */
export function isPrivateAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(ip) === 4) return privateIpv4(ip.split(".").map(Number));
  if (isIP(ip) !== 6) return true;
  const g = ipv6Groups(ip);
  if (!g) return true;
  const zeroUpTo = (n: number) => g.slice(0, n).every((group) => group === 0);
  if (zeroUpTo(7) && g[7] <= 1) return true; // :: и ::1
  if (zeroUpTo(5) && g[5] === 0xffff) return privateIpv4(embeddedIpv4(g, 6)); // ::ffff:a.b.c.d
  if (zeroUpTo(6)) return privateIpv4(embeddedIpv4(g, 6)); // ::a.b.c.d (устаревшая запись)
  if (g[0] === 0x64 && g[1] === 0xff9b) {
    // NAT64: общий префикс ведёт на встроенный IPv4, локальный 64:ff9b:1:: — закрыт.
    return g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0 ? privateIpv4(embeddedIpv4(g, 6)) : true;
  }
  if (g[0] === 0x2002) return privateIpv4(embeddedIpv4(g, 1)); // 6to4
  if (g[0] === 0x2001 && (g[1] === 0 || g[1] === 0xdb8)) return true; // Teredo, документация
  if (g[0] === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true; // discard
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 — частная сеть
  if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return true; // link-/site-local
  return (g[0] & 0xff00) === 0xff00; // multicast
}

/** Код ошибки DNS, которым сокету отказано в адресе внутренней сети. */
const BLOCKED = "EQAIRUBLOCKED";

/**
 * DNS для сокета: адреса проверяются в момент подключения, и сокет идёт
 * ровно на проверенный адрес. Одной проверки до запроса мало: DNS может
 * ответить ей публичным адресом, а сокету — 127.0.0.1 (DNS rebinding).
 * На Vercel по 127.0.0.1:9001 слушает Runtime API самой функции.
 */
export function checkedLookup(
  hostname: string,
  options: LookupOptions,
  callback: (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
): void {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, "");
    const list = addresses as LookupAddress[];
    if (list.length === 0 || list.some((entry) => isPrivateAddress(entry.address))) {
      return callback(Object.assign(new Error(`${hostname}: адрес внутренней сети`), { code: BLOCKED }), "");
    }
    if (options.all) callback(null, list);
    else callback(null, list[0].address, list[0].family);
  });
}

/** Соединения только через checkedLookup. */
const agent = new Agent({ connect: { lookup: checkedLookup } });

/** Отказал ли checkedLookup — ищем его код в цепочке причин ошибки fetch. */
function blockedByLookup(error: unknown): boolean {
  for (let current = error; current instanceof Error; current = current.cause) {
    if ((current as NodeJS.ErrnoException).code === BLOCKED) return true;
  }
  return false;
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
    let response: Awaited<ReturnType<typeof fetch>>;
    try {
      response = await fetch(url, {
        redirect: "manual",
        dispatcher: agent,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: "text/calendar, text/plain;q=0.9, */*;q=0.5", "user-agent": "QairuCowork calendar sync" },
      });
    } catch (error) {
      return { ok: false, error: blockedByLookup(error) ? "blocked" : "unreachable" };
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
