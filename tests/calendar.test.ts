import { fetch } from "undici";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { startTestDb } from "./support/db";

// Календари качает undici (проверка адреса при подключении) — вместо сети ответ подставляется здесь.
vi.mock("undici", async (importOriginal) => ({ ...(await importOriginal<typeof import("undici")>()), fetch: vi.fn() }));

beforeAll(async () => {
  await startTestDb();
});

afterEach(() => {
  vi.mocked(fetch).mockReset();
});

/** Сервер календаря отвечает так. */
function serve(handler: () => Promise<Response>) {
  vi.mocked(fetch).mockImplementation(handler as unknown as typeof fetch);
}

async function mods() {
  return { repo: await import("@/db/repo"), sync: await import("@/lib/calendarSync") };
}

// Публичный IP-адрес вместо домена: проверка адреса не ходит в DNS, а fetch подменён.
const PUBLIC = "https://93.184.216.34/cal.ics";

function calendarResponse(body: string, init: ResponseInit = {}) {
  return new Response(body, { status: 200, headers: { "content-type": "text/calendar" }, ...init });
}

describe("ссылка на календарь", () => {
  it("webcal — это https, логин в ссылке и не-http отвергаются", async () => {
    const { sync } = await mods();
    expect(sync.normalizeCalendarUrl(" webcal://calendar.google.com/cal.ics ")).toBe("https://calendar.google.com/cal.ics");
    expect(sync.normalizeCalendarUrl("ftp://example.com/cal.ics")).toBeNull();
    expect(sync.normalizeCalendarUrl("https://user:pass@example.com/cal.ics")).toBeNull();
    expect(sync.normalizeCalendarUrl("https://localhost/cal.ics")).toBeNull();
    expect(sync.normalizeCalendarUrl("не ссылка")).toBeNull();
  });

  it("внутренняя сеть закрыта", async () => {
    const { sync } = await mods();
    for (const address of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "::1", "fd00::1", "::ffff:10.0.0.1"]) {
      expect(sync.isPrivateAddress(address)).toBe(true);
    }
    expect(sync.isPrivateAddress("93.184.216.34")).toBe(false);
    expect(sync.isPrivateAddress("2606:4700::1111")).toBe(false);
  });

  it("IPv4, спрятанный в IPv6, и служебные диапазоны тоже закрыты", async () => {
    const { sync } = await mods();
    const blocked = [
      "::ffff:7f00:1", // так URL записывает ::ffff:127.0.0.1
      "[::ffff:a9fe:a9fe]", // 169.254.169.254
      "::127.0.0.1",
      "::7f00:1",
      "64:ff9b::7f00:1", // NAT64 → 127.0.0.1
      "64:ff9b:1::1",
      "2002:7f00:1::1", // 6to4 → 127.0.0.1
      "2001::1", // Teredo
      "2001:db8::1",
      "fe80::1",
      "fec0::1",
      "ff02::1",
      "0.0.0.0",
      "192.0.0.8",
      "198.18.0.1",
      "::",
      "не адрес",
    ];
    for (const address of blocked) expect(sync.isPrivateAddress(address), address).toBe(true);
    for (const address of ["8.8.8.8", "64:ff9b::5db8:d822", "2002:5db8:d822::1", "2a00:1450:4001::200e"]) {
      expect(sync.isPrivateAddress(address), address).toBe(false);
    }
  });

  it("адрес числом и IPv6 в ссылке в сеть не уходят", async () => {
    const { sync } = await mods();
    // 2130706433 — это 127.0.0.1: URL приводит его к обычной записи.
    expect(await sync.fetchCalendar("http://2130706433/cal.ics")).toEqual({ ok: false, error: "blocked" });
    // IPv6 в квадратных скобках не проходит ещё разбор ссылки.
    expect(await sync.fetchCalendar("https://[::ffff:127.0.0.1]/cal.ics")).toEqual({ ok: false, error: "bad_url" });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});

describe("загрузка календаря", () => {
  it("раскладывает занятость и отмечает расписание заполненным", async () => {
    const { repo, sync } = await mods();
    const user = await repo.createWebUser({ fullName: "Календарь", lang: "ru" });
    const { todayIn, addDays } = await import("@/core/timeutils");
    const day = addDays(todayIn("Asia/Almaty"), 2).replaceAll("-", "");
    serve(async () =>
      calendarResponse(
        `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:1\r\nDTSTART;TZID=Asia/Almaty:${day}T090000\r\nDTEND;TZID=Asia/Almaty:${day}T103000\r\nSUMMARY:Секрет\r\nEND:VEVENT\r\nEND:VCALENDAR`,
      ),
    );
    await repo.setCalendarUrl(user.userId, PUBLIC);
    expect(await sync.syncCalendar(user.userId, PUBLIC)).toEqual({ ok: true, count: 1 });

    const slots = (await repo.datedSlots(user.userId)).filter((slot) => slot.source === repo.CALENDAR_SOURCE);
    expect(slots.map((slot) => [slot.startMin, slot.endMin, slot.label])).toEqual([[540, 630, ""]]);
    expect(await repo.isFilled(user.userId)).toBe(true);
    expect((await repo.getUser(user.userId))?.calendarError).toBeNull();

    // Отключение стирает занятость из календаря.
    await repo.setCalendarUrl(user.userId, null);
    expect((await repo.datedSlots(user.userId)).filter((slot) => slot.source === repo.CALENDAR_SOURCE)).toEqual([]);
  });

  it("переадресация во внутреннюю сеть блокируется", async () => {
    const { sync } = await mods();
    serve(async () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest" } }));
    expect(await sync.fetchCalendar(PUBLIC)).toEqual({ ok: false, error: "blocked" });
  });

  it("страница вместо календаря и слишком большой файл — понятные ошибки", async () => {
    const { repo, sync } = await mods();
    serve(async () => calendarResponse("<!doctype html><title>Войти</title>"));
    expect(await sync.fetchCalendar(PUBLIC)).toEqual({ ok: false, error: "not_ics" });

    serve(async () => calendarResponse(`BEGIN:VCALENDAR\r\n${"X".repeat(2_200_000)}`));
    expect(await sync.fetchCalendar(PUBLIC)).toEqual({ ok: false, error: "too_large" });

    // Ошибка запоминается, прежняя занятость не стирается.
    const user = await repo.createWebUser({ fullName: "Ошибка", lang: "ru" });
    await repo.replaceCalendarSlots(user.userId, [{ day: "2026-09-24", start: 540, end: 600 }]);
    await repo.setCalendarUrl(user.userId, PUBLIC);
    await repo.replaceCalendarSlots(user.userId, [{ day: "2026-09-24", start: 540, end: 600 }]);
    expect(await sync.syncCalendar(user.userId, PUBLIC)).toEqual({ ok: false, error: "too_large" });
    expect((await repo.getUser(user.userId))?.calendarError).toBe("too_large");
    expect(await repo.calendarSlotCount(user.userId, "2026-09-01")).toBe(1);
  });

  it("cron берёт сначала никогда не загруженные, потом самые старые", async () => {
    const { repo } = await mods();
    const fresh = await repo.createWebUser({ fullName: "Свежий", lang: "ru" });
    const old = await repo.createWebUser({ fullName: "Старый", lang: "ru" });
    const never = await repo.createWebUser({ fullName: "Никогда", lang: "ru" });
    for (const user of [fresh, old, never]) await repo.setCalendarUrl(user.userId, PUBLIC);
    await repo.setCalendarStatus(fresh.userId, { syncedAt: new Date(), error: null });
    await repo.setCalendarStatus(old.userId, { syncedAt: new Date(Date.now() - 10 * 3_600_000), error: null });

    const stale = await repo.staleCalendars(new Date(Date.now() - 3 * 3_600_000), 100);
    const ids = stale.map((row) => row.userId);
    expect(ids).toContain(never.userId);
    expect(ids).toContain(old.userId);
    expect(ids).not.toContain(fresh.userId);
    expect(ids.indexOf(never.userId)).toBeLessThan(ids.indexOf(old.userId));
  });
});
