import { describe, expect, it } from "vitest";

import { busyFromIcs, looksLikeIcs } from "@/core/ics";

const TZ = "Asia/Almaty"; // UTC+5
const cal = (...events: string[]) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", ...events.flatMap((event) => ["BEGIN:VEVENT", event.trim(), "END:VEVENT"]), "END:VCALENDAR"].join("\r\n");

describe("календарь .ics", () => {
  it("событие в UTC переводится в пояс человека", () => {
    const text = cal("UID:1\nDTSTART:20260922T040000Z\nDTEND:20260922T053000Z");
    expect(busyFromIcs(text, TZ, "2026-09-21", "2026-09-27")).toEqual([{ day: "2026-09-22", start: 540, end: 630 }]);
  });

  it("TZID и «плавающее» время", () => {
    const text = cal(
      "UID:2\nDTSTART;TZID=Europe/Moscow:20260923T100000\nDTEND;TZID=Europe/Moscow:20260923T113000",
      "UID:3\nDTSTART:20260924T140000\nDURATION:PT1H30M",
    );
    expect(busyFromIcs(text, TZ, "2026-09-21", "2026-09-27")).toEqual([
      { day: "2026-09-23", start: 720, end: 810 }, // Москва UTC+3 → Алматы UTC+5
      { day: "2026-09-24", start: 840, end: 930 },
    ]);
  });

  it("событие на весь день и через полночь", () => {
    const text = cal(
      "UID:4\nDTSTART;VALUE=DATE:20260925\nDTEND;VALUE=DATE:20260927",
      "UID:5\nDTSTART;TZID=Asia/Almaty:20260922T230000\nDTEND;TZID=Asia/Almaty:20260923T013000",
    );
    expect(busyFromIcs(text, TZ, "2026-09-21", "2026-09-27")).toEqual([
      { day: "2026-09-22", start: 1380, end: 1440 },
      { day: "2026-09-23", start: 0, end: 90 },
      { day: "2026-09-25", start: 0, end: 1440 },
      { day: "2026-09-26", start: 0, end: 1440 },
    ]);
  });

  it("еженедельный повтор по дням с исключением и переносом", () => {
    const text = cal(
      [
        "UID:pairs",
        "DTSTART;TZID=Asia/Almaty:20260907T090000",
        "DTEND;TZID=Asia/Almaty:20260907T103000",
        "RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261001T000000Z",
        "EXDATE;TZID=Asia/Almaty:20260923T090000",
      ].join("\n"),
      // Понедельничная пара 21-го перенесена на 12:00.
      "UID:pairs\nRECURRENCE-ID;TZID=Asia/Almaty:20260921T090000\nDTSTART;TZID=Asia/Almaty:20260921T120000\nDTEND;TZID=Asia/Almaty:20260921T133000",
    );
    expect(busyFromIcs(text, TZ, "2026-09-21", "2026-10-04")).toEqual([
      { day: "2026-09-21", start: 720, end: 810 },
      // 23-е исключено, 30-е — последнее до UNTIL.
      { day: "2026-09-28", start: 540, end: 630 },
      { day: "2026-09-30", start: 540, end: 630 },
    ]);
  });

  it("отменённый повтор и «свободные» события не занимают время", () => {
    const text = cal(
      "UID:s\nDTSTART:20260921T040000Z\nDTEND:20260921T050000Z\nRRULE:FREQ=DAILY;COUNT=3",
      "UID:s\nRECURRENCE-ID:20260922T040000Z\nDTSTART:20260922T040000Z\nDTEND:20260922T050000Z\nSTATUS:CANCELLED",
      "UID:free\nDTSTART:20260924T040000Z\nDTEND:20260924T050000Z\nTRANSP:TRANSPARENT",
      "UID:gone\nDTSTART:20260925T040000Z\nDTEND:20260925T050000Z\nSTATUS:CANCELLED",
    );
    expect(busyFromIcs(text, TZ, "2026-09-21", "2026-09-27")).toEqual([
      { day: "2026-09-21", start: 540, end: 600 },
      // 22-е отменено, COUNT=3 — третье 23-го, дальше повторов нет.
      { day: "2026-09-23", start: 540, end: 600 },
    ]);
  });

  it("серия, начатая много лет назад, доходит до нужной недели", () => {
    const text = cal("UID:old\nDTSTART:20150105T040000Z\nDTEND:20150105T050000Z\nRRULE:FREQ=DAILY");
    const busy = busyFromIcs(text, TZ, "2026-09-21", "2026-09-22");
    expect(busy).toEqual([
      { day: "2026-09-21", start: 540, end: 600 },
      { day: "2026-09-22", start: 540, end: 600 },
    ]);
  });

  it("правило, которого не понимаем, — только первая встреча", () => {
    const text = cal("UID:x\nDTSTART:20260922T040000Z\nDTEND:20260922T050000Z\nRRULE:FREQ=MONTHLY;BYDAY=1MO");
    expect(busyFromIcs(text, TZ, "2026-09-01", "2026-12-31")).toEqual([{ day: "2026-09-22", start: 540, end: 600 }]);
  });

  it("склеивает перенесённые строки и пропускает напоминания внутри события", () => {
    const text = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:fold",
      "DTSTART;TZID=Asia/Alm",
      " aty:20260922T090000",
      "DTEND;TZID=Asia/Almaty:20260922T100000",
      "BEGIN:VALARM",
      "TRIGGER:-PT15M",
      "DTSTART:20990101T000000Z",
      "END:VALARM",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    expect(busyFromIcs(text, TZ, "2026-09-21", "2026-09-27")).toEqual([{ day: "2026-09-22", start: 540, end: 600 }]);
  });

  it("отличает календарь от страницы с ошибкой", () => {
    expect(looksLikeIcs("BEGIN:VCALENDAR\r\nEND:VCALENDAR")).toBe(true);
    expect(looksLikeIcs("<!doctype html><title>Sign in</title>")).toBe(false);
  });
});
