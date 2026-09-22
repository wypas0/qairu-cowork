import { describe, expect, it } from "vitest";

import { upcomingByChat, nextOccurrence, occurrencesBetween, seriesOver, weeklyRule } from "@/core/recurrence";
import { zonedWallToUtc } from "@/core/timeutils";

const TZ = "Asia/Almaty";
// Среда, 23 сентября 2026, 15:00 по Алматы.
const FIRST = zonedWallToUtc("2026-09-23", 15 * 60, TZ);

describe("повторяющиеся встречи", () => {
  it("разовая встреча попадает в промежуток только сама", () => {
    const week = [zonedWallToUtc("2026-09-21", 0, TZ), zonedWallToUtc("2026-09-28", 0, TZ)] as const;
    expect(occurrencesBetween(FIRST, null, TZ, ...week)).toEqual([FIRST]);
    const next = [zonedWallToUtc("2026-09-28", 0, TZ), zonedWallToUtc("2026-10-05", 0, TZ)] as const;
    expect(occurrencesBetween(FIRST, null, TZ, ...next)).toEqual([]);
  });

  it("каждую неделю в тот же день и час, пока не кончится серия", () => {
    const month = [zonedWallToUtc("2026-09-21", 0, TZ), zonedWallToUtc("2026-10-19", 0, TZ)] as const;
    const all = occurrencesBetween(FIRST, "2026-10-07", TZ, ...month);
    expect(all).toEqual([
      zonedWallToUtc("2026-09-23", 15 * 60, TZ),
      zonedWallToUtc("2026-09-30", 15 * 60, TZ),
      zonedWallToUtc("2026-10-07", 15 * 60, TZ),
    ]);
  });

  it("находит повтор далеко от начала серии, не перебирая всё подряд", () => {
    const week = [zonedWallToUtc("2027-03-01", 0, TZ), zonedWallToUtc("2027-03-08", 0, TZ)] as const;
    expect(occurrencesBetween(FIRST, "2027-06-30", TZ, ...week)).toEqual([
      zonedWallToUtc("2027-03-03", 15 * 60, TZ),
    ]);
  });

  it("ближайший повтор — следующий ещё не начавшийся", () => {
    const afterFirst = zonedWallToUtc("2026-09-23", 16 * 60, TZ);
    expect(nextOccurrence(FIRST, "2026-10-07", TZ, afterFirst)).toEqual(
      zonedWallToUtc("2026-09-30", 15 * 60, TZ),
    );
    const afterLast = zonedWallToUtc("2026-10-07", 16 * 60, TZ);
    expect(nextOccurrence(FIRST, "2026-10-07", TZ, afterLast)).toBeNull();
  });

  it("серия кончается после последней даты, а правило для календаря — до её конца", () => {
    expect(seriesOver("2026-10-07", "2026-10-07")).toBe(false);
    expect(seriesOver("2026-10-07", "2026-10-08")).toBe(true);
    // 23:59 по Алматы (UTC+5) — это 18:59 UTC.
    expect(weeklyRule("2026-10-07", TZ)).toBe("FREQ=WEEKLY;UNTIL=20261007T185900Z");
  });
});

describe("предстоящие встречи группы", () => {
  const NOW = zonedWallToUtc("2026-09-22", 12 * 60, TZ);
  const tz = () => TZ;
  const at = (day: string, minutes: number) => zonedWallToUtc(day, minutes, TZ);

  it("все будущие по времени, без прошедших и без времени", () => {
    const result = upcomingByChat(
      [
        { id: 1, chatId: 10, whenStart: at("2026-09-21", 15 * 60), repeatUntil: null },
        { id: 2, chatId: 10, whenStart: at("2026-09-25", 10 * 60), repeatUntil: null },
        { id: 3, chatId: 10, whenStart: at("2026-09-23", 18 * 60), repeatUntil: null },
        { id: 4, chatId: 10, whenStart: null, repeatUntil: null },
        { id: 5, chatId: 20, whenStart: at("2026-09-20", 9 * 60), repeatUntil: null },
      ],
      tz,
      NOW,
    );
    expect(result.get(10)?.map((item) => item.meeting.id)).toEqual([3, 2]);
    expect(result.has(20)).toBe(false);
  });

  it("для серии, начавшейся раньше, показывает ближайший повтор", () => {
    const result = upcomingByChat(
      [{ id: 7, chatId: 10, whenStart: at("2026-09-02", 15 * 60), repeatUntil: "2026-12-16" }],
      tz,
      NOW,
    );
    expect(result.get(10)?.[0].start).toEqual(at("2026-09-23", 15 * 60));
  });

  it("закончившаяся серия встречей не считается", () => {
    const result = upcomingByChat(
      [{ id: 8, chatId: 10, whenStart: at("2026-08-05", 15 * 60), repeatUntil: "2026-09-16" }],
      tz,
      NOW,
    );
    expect(result.size).toBe(0);
  });
});
