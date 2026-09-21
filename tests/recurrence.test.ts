import { describe, expect, it } from "vitest";

import { nextOccurrence, occurrencesBetween, seriesOver, weeklyRule } from "@/core/recurrence";
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
