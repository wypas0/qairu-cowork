import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { startTestDb } from "./support/db";

beforeAll(async () => {
  await startTestDb();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

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
});

describe("загрузка календаря", () => {
  it("раскладывает занятость и отмечает расписание заполненным", async () => {
    const { repo, sync } = await mods();
    const user = await repo.createWebUser({ fullName: "Календарь", lang: "ru" });
    const { todayIn, addDays } = await import("@/core/timeutils");
    const day = addDays(todayIn("Asia/Almaty"), 2).replaceAll("-", "");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        calendarResponse(
          `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:1\r\nDTSTART;TZID=Asia/Almaty:${day}T090000\r\nDTEND;TZID=Asia/Almaty:${day}T103000\r\nSUMMARY:Секрет\r\nEND:VEVENT\r\nEND:VCALENDAR`,
        ),
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
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest" } })),
    );
    expect(await sync.fetchCalendar(PUBLIC)).toEqual({ ok: false, error: "blocked" });
  });

  it("страница вместо календаря и слишком большой файл — понятные ошибки", async () => {
    const { repo, sync } = await mods();
    vi.stubGlobal("fetch", vi.fn(async () => calendarResponse("<!doctype html><title>Войти</title>")));
    expect(await sync.fetchCalendar(PUBLIC)).toEqual({ ok: false, error: "not_ics" });

    vi.stubGlobal("fetch", vi.fn(async () => calendarResponse(`BEGIN:VCALENDAR\r\n${"X".repeat(2_200_000)}`)));
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
