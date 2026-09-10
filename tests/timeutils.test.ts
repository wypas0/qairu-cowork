import { describe, expect, it } from "vitest";

import { buildIcs } from "@/core/calendar";
import { clip, escapeHtml } from "@/core/textutils";
import {
  addDays,
  diffDays,
  formatDM,
  formatDMY,
  isDateStr,
  parseDateToken,
  todayIn,
  tzOf,
  weekdayOf,
  zonedWallToUtc,
} from "@/core/timeutils";

describe("календарные даты", () => {
  it("складываются и вычитаются через границы месяцев", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(diffDays("2026-09-07", "2026-09-14")).toBe(7);
  });

  it("знают день недели с понедельника", () => {
    expect(weekdayOf("2026-09-07")).toBe(0); // понедельник
    expect(weekdayOf("2026-09-13")).toBe(6); // воскресенье
  });

  it("проверяются на существование", () => {
    expect(isDateStr("2026-09-07")).toBe(true);
    expect(isDateStr("2026-02-30")).toBe(false);
    expect(isDateStr("07.09.2026")).toBe(false);
  });

  it("форматируются для показа", () => {
    expect(formatDMY("2026-09-07")).toBe("07.09.2026");
    expect(formatDM("2026-09-07")).toBe("07.09");
  });
});

describe("parseDateToken", () => {
  const today = "2026-09-10";

  it("понимает разные разделители", () => {
    expect(parseDateToken("12.09", today)).toBe("2026-09-12");
    expect(parseDateToken("12/09", today)).toBe("2026-09-12");
    expect(parseDateToken("12-09-2027", today)).toBe("2027-09-12");
  });

  it("без года подставляет ближайший будущий", () => {
    expect(parseDateToken("01.09", today)).toBe("2027-09-01");
  });

  it("отбрасывает несуществующие даты", () => {
    expect(parseDateToken("31.02", today)).toBeNull();
    expect(parseDateToken("не дата", today)).toBeNull();
  });
});

describe("часовые пояса", () => {
  it("подставляет запасной пояс вместо несуществующего", () => {
    expect(tzOf("Asia/Almaty")).toBe("Asia/Almaty");
    expect(tzOf("Nowhere/Nothing")).toBe("Asia/Almaty");
  });

  it("переводит настенное время группы в UTC", () => {
    // Алматы — UTC+5 круглый год, перехода на летнее время нет.
    const moment = zonedWallToUtc("2026-09-14", 15 * 60, "Asia/Almaty");
    expect(moment.toISOString()).toBe("2026-09-14T10:00:00.000Z");
  });

  it("учитывает переход на летнее время", () => {
    // Берлин 14 сентября — UTC+2 (CEST), 14 декабря — UTC+1 (CET).
    expect(zonedWallToUtc("2026-09-14", 12 * 60, "Europe/Berlin").toISOString()).toBe(
      "2026-09-14T10:00:00.000Z",
    );
    expect(zonedWallToUtc("2026-12-14", 12 * 60, "Europe/Berlin").toISOString()).toBe(
      "2026-12-14T11:00:00.000Z",
    );
  });

  it("сегодняшняя дата берётся в поясе группы, а не сервера", () => {
    // 21:00 UTC — в Алматы это уже следующий день.
    const moment = new Date("2026-09-14T21:00:00.000Z");
    expect(todayIn("UTC", moment)).toBe("2026-09-14");
    expect(todayIn("Asia/Almaty", moment)).toBe("2026-09-15");
  });
});

describe(".ics", () => {
  it("собирает валидный VEVENT в UTC", () => {
    const text = buildIcs({
      uid: "meeting-7",
      summary: "Разбор задач",
      start: new Date("2026-09-14T10:00:00.000Z"),
      durationMin: 90,
      location: "Библиотека, 3 этаж",
    });
    expect(text.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(text).toContain("UID:meeting-7@qairucowork");
    expect(text).toContain("DTSTART:20260914T100000Z");
    expect(text).toContain("DTEND:20260914T113000Z");
    // Запятая в адресе обязана быть экранирована, иначе поле распадётся надвое.
    expect(text).toContain("LOCATION:Библиотека\\, 3 этаж");
    expect(text.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("не даёт нулевой длительности", () => {
    const text = buildIcs({
      uid: "x",
      summary: "s",
      start: new Date("2026-09-14T10:00:00.000Z"),
      durationMin: 0,
    });
    expect(text).toContain("DTEND:20260914T101500Z");
  });
});

describe("обрезка длинных сообщений", () => {
  it("короткий текст не трогает", () => {
    expect(clip("привет", 100)).toBe("привет");
  });

  it("режет по границе строки и дописывает пометку", () => {
    const text = Array.from({ length: 50 }, (_, index) => `строка ${index}`).join("\n");
    const cut = clip(text, 100, "обрезано");
    expect(cut.length).toBeLessThan(text.length);
    expect(cut.endsWith("обрезано")).toBe(true);
    expect(cut).not.toContain("строка 49");
  });

  it("экранирует HTML для Telegram", () => {
    expect(escapeHtml("<b>a & b</b>")).toBe("&lt;b&gt;a &amp; b&lt;/b&gt;");
  });
});
