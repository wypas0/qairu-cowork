/**
 * Разбор календаря не зависит от длины события (ревью 16.11.2026, Р2).
 *
 * Календарь из восьми строк с событием на 50 лет и ежедневным повтором
 * разбирался 41 с: цикл по дням каждого повтора шёл от его начала до конца,
 * а не по окну. Ссылка на такой файл съедала весь прогон cron.
 */

import { describe, expect, it } from "vitest";

import { busyFromIcs, type IcsBusy } from "@/core/ics";
import { type DateStr, addDays, compareDates } from "@/core/timeutils";

const TZ = "Asia/Almaty";
// Окно как у cron (lib/calendarSync): вчера … девять недель вперёд.
const FROM: DateStr = "2026-11-16";
const TO: DateStr = addDays(FROM, 64);
const LIMIT_MS = 500;

function calendar(...event: string[]): string {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "UID:long@test", ...event, "END:VEVENT", "END:VCALENDAR"].join(
    "\r\n",
  );
}

function timed(text: string): { pieces: IcsBusy[]; ms: number } {
  const started = performance.now();
  const pieces = busyFromIcs(text, TZ, FROM, TO);
  return { pieces, ms: performance.now() - started };
}

/** Каждый день окна занят целиком, и ни одного куска вне окна. */
function expectWholeWindowBusy(pieces: IcsBusy[]): void {
  for (const piece of pieces) {
    expect(compareDates(piece.day, FROM)).toBeGreaterThanOrEqual(0);
    expect(compareDates(piece.day, TO)).toBeLessThanOrEqual(0);
  }
  for (let day = FROM; compareDates(day, TO) <= 0; day = addDays(day, 1)) {
    expect(pieces.some((piece) => piece.day === day && piece.start === 0 && piece.end === 1440), day).toBe(true);
  }
}

describe("длинные события в календаре", () => {
  it("событие 2020–2070 с ежедневным повтором (календарь из Р2) — быстро и занято всё окно", () => {
    const { pieces, ms } = timed(calendar("DTSTART:20200101T000000Z", "DTEND:20700101T000000Z", "RRULE:FREQ=DAILY"));
    expect(ms, `разбор занял ${Math.round(ms)} мс`).toBeLessThan(LIMIT_MS);
    expectWholeWindowBusy(pieces);
  });

  it("то же событие на весь день (VALUE=DATE)", () => {
    const { pieces, ms } = timed(
      calendar("DTSTART;VALUE=DATE:20200101", "DTEND;VALUE=DATE:20700101", "RRULE:FREQ=DAILY"),
    );
    expect(ms, `разбор занял ${Math.round(ms)} мс`).toBeLessThan(LIMIT_MS);
    expectWholeWindowBusy(pieces);
  });

  it("событие на 8000 лет с ежедневным повтором", () => {
    const { pieces, ms } = timed(calendar("DTSTART:20000101T000000Z", "DTEND:99991231T000000Z", "RRULE:FREQ=DAILY"));
    expect(ms, `разбор занял ${Math.round(ms)} мс`).toBeLessThan(LIMIT_MS);
    expectWholeWindowBusy(pieces);
  });

  it("событие на 8000 лет без повтора, в том числе с концом за 9999 годом", () => {
    for (const end of ["DTEND:99991231T000000Z", "DURATION:P2922000D"]) {
      const { pieces, ms } = timed(calendar("DTSTART:20200101T000000Z", end));
      expect(ms, `${end}: разбор занял ${Math.round(ms)} мс`).toBeLessThan(LIMIT_MS);
      expectWholeWindowBusy(pieces);
    }
  });

  it("событие на весь день длиной 8000 лет (конец — пятизначный год)", () => {
    const { pieces, ms } = timed(calendar("DTSTART;VALUE=DATE:20200101", "DURATION:P2922000D", "RRULE:FREQ=DAILY"));
    expect(ms, `разбор занял ${Math.round(ms)} мс`).toBeLessThan(LIMIT_MS);
    expectWholeWindowBusy(pieces);
  });

  it("многодневное событие, начатое до окна, по-прежнему занимает свои дни в окне", () => {
    // Поездка на три недели, началась за неделю до окна: заняты первые две недели окна.
    const { pieces } = timed(calendar("DTSTART;VALUE=DATE:20261109", "DTEND;VALUE=DATE:20261130"));
    expect(pieces.map((piece) => piece.day)).toEqual(
      Array.from({ length: 14 }, (_, index) => addDays(FROM, index)),
    );
  });
});
