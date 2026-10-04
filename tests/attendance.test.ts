/**
 * «Был ли ты на встрече»: какой повтор только что закончился и какой последним;
 * запросы — на настоящем Postgres (PGlite), как в repo.test.ts.
 */

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { justEnded, lastEnded } from "@/core/attendance";
import { startTestDb } from "./support/db";

const TZ = "Asia/Almaty"; // UTC+5
const at = (iso: string) => new Date(iso);

describe("justEnded", () => {
  const once = { whenStart: at("2026-10-05T10:00:00Z"), repeatUntil: null }; // 15:00 по Алматы

  it("разовая: спрашиваем после конца, но не раньше и не через сутки", () => {
    expect(justEnded(once, 90, TZ, at("2026-10-05T11:00:00Z"))).toBeNull(); // ещё идёт
    expect(justEnded(once, 90, TZ, at("2026-10-05T11:31:00Z"))?.day).toBe("2026-10-05");
    expect(justEnded(once, 90, TZ, at("2026-10-05T23:00:00Z"))?.day).toBe("2026-10-05"); // 11,5 ч после конца
    expect(justEnded(once, 90, TZ, at("2026-10-06T12:00:00Z"))).toBeNull(); // больше 12 ч прошло
  });

  it("серия: каждый повтор по отдельности", () => {
    const weekly = { whenStart: at("2026-09-07T10:00:00Z"), repeatUntil: "2026-12-12" };
    expect(justEnded(weekly, 60, TZ, at("2026-09-21T11:30:00Z"))?.day).toBe("2026-09-21");
    expect(justEnded(weekly, 60, TZ, at("2026-09-24T11:30:00Z"))).toBeNull(); // между повторами
    expect(justEnded(weekly, 60, TZ, at("2026-09-28T11:05:00Z"))?.day).toBe("2026-09-28");
  });

  it("без точного времени — не спрашиваем", () => {
    expect(justEnded({ whenStart: null, repeatUntil: null }, 60, TZ, at("2026-10-05T12:00:00Z"))).toBeNull();
  });
});

describe("lastEnded", () => {
  it("последний закончившийся повтор серии, у разовой — её день", () => {
    const weekly = { whenStart: at("2026-09-07T10:00:00Z"), repeatUntil: "2026-09-28" };
    expect(lastEnded(weekly, 60, TZ, at("2026-10-03T12:00:00Z"))).toBe("2026-09-28");
    expect(lastEnded(weekly, 60, TZ, at("2026-09-21T10:30:00Z"))).toBe("2026-09-14"); // 21-е ещё идёт
    expect(lastEnded({ whenStart: at("2026-10-01T10:00:00Z"), repeatUntil: null }, 60, TZ, at("2026-10-03T00:00:00Z"))).toBe(
      "2026-10-01",
    );
    expect(lastEnded({ whenStart: at("2026-10-05T10:00:00Z"), repeatUntil: null }, 60, TZ, at("2026-10-03T00:00:00Z"))).toBeNull();
  });
});

describe("запросы", () => {
  beforeAll(async () => {
    await startTestDb();
  });
  const repo = () => import("@/db/repo");
  const saved = { alert: process.env.ALERT_CHAT_ID, owners: process.env.OWNER_IDS };
  afterEach(() => {
    // Присвоить undefined нельзя: в process.env оно станет строкой "undefined".
    if (saved.alert === undefined) delete process.env.ALERT_CHAT_ID;
    else process.env.ALERT_CHAT_ID = saved.alert;
    if (saved.owners === undefined) delete process.env.OWNER_IDS;
    else process.env.OWNER_IDS = saved.owners;
  });

  it("посещения: ответ заменяет прежний, счёт по людям группы", async () => {
    const r = await repo();
    await r.upsertUser({ userId: 501, username: null, fullName: "Аян" });
    await r.upsertUser({ userId: 502, username: null, fullName: "Бек" });
    await r.upsertChat(-5001, "Группа");
    const meeting = await r.createMeeting({
      chatId: -5001,
      initiatorId: 501,
      place: "",
      whenText: "",
      goal: "Созвон",
      invitees: [501, 502],
      whenStart: at("2026-09-07T10:00:00Z"),
      durationMin: 60,
      repeatUntil: "2026-12-12",
    });
    await r.setAttendance({ meetingId: meeting.id, occurrence: "2026-09-07", userId: 501, attended: false });
    await r.setAttendance({ meetingId: meeting.id, occurrence: "2026-09-07", userId: 501, attended: true });
    await r.setAttendance({ meetingId: meeting.id, occurrence: "2026-09-14", userId: 501, attended: true });
    await r.setAttendance({ meetingId: meeting.id, occurrence: "2026-09-07", userId: 502, attended: false });

    const byUser = await r.attendanceByUser(-5001);
    expect(byUser.get(501)).toEqual({ attended: 2, total: 2 });
    expect(byUser.get(502)).toEqual({ attended: 0, total: 1 });
    const rows = (await r.attendanceFor([meeting.id])).get(meeting.id) ?? [];
    expect(rows).toHaveLength(3);

    // Кандидаты на вопрос: серия идёт, встреча уже начиналась.
    const candidates = await r.attendanceCandidates(at("2026-09-28T11:05:00Z"), "2026-09-27");
    expect(candidates.map((row) => row.id)).toContain(meeting.id);
  });

  it("источник расписания и часы в неделю без «неудобно»", async () => {
    const r = await repo();
    await r.upsertUser({ userId: 503, username: null, fullName: "Вера" });
    await r.replaceWeeklySlots(503, [0, 1, 2, 3, 4, 5, 6], [
      { weekday: 0, start: 480, end: 590, kind: "lecture" },
      { weekday: 2, start: 600, end: 650, kind: "practice" },
      { weekday: 5, start: 600, end: 720, kind: "soft" },
    ], "web", undefined, { withSoft: true });
    expect((await r.weeklyBusyMinutes([503])).get(503)).toBe(160);
    expect((await r.scheduleOrigins([503])).get(503)).toBe("manual");

    await r.setScheduleOrigin(503, "campus", "0.3.0");
    expect((await r.scheduleOrigins([503])).get(503)).toBe("campus");
    const stats = await r.siteStats();
    expect(stats.schedule.versions).toContainEqual({ version: "0.3.0", count: 1 });
    expect(stats.schedule.origins.find((row) => row.origin === "campus")?.count).toBe(1);
    expect(stats.meetings.asked).toBeGreaterThanOrEqual(3);
    expect(stats.users.total).toBeGreaterThanOrEqual(3);
  });

  it("владелец — ALERT_CHAT_ID и OWNER_IDS, чат-группа (минус) не считается", async () => {
    const { isOwner } = await import("@/lib/owner");
    process.env.ALERT_CHAT_ID = "777";
    process.env.OWNER_IDS = "888, x, -5";
    expect(isOwner(777)).toBe(true);
    expect(isOwner(888)).toBe(true);
    expect(isOwner(999)).toBe(false);
    process.env.ALERT_CHAT_ID = "-100123";
    process.env.OWNER_IDS = "";
    expect(isOwner(-100123)).toBe(false);
  });
});
