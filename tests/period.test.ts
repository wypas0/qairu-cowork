/**
 * Пары из кампуса: недельная пара с периодом действия (триместр) и датами-
 * исключениями (праздники, отменённые пары). После триместра и в праздник
 * время свободно само — без правки расписания.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { PersonSchedule } from "@/core/availability";
import { cleanIncomingSlots, cleanPeriod, editorSlots } from "@/core/grid";
import { startTestDb } from "./support/db";

const lecture = (from: string, to: string, except: string[] = []) =>
  new PersonSchedule({
    userId: 1,
    name: "Амир",
    bounded: [{ weekday: 0, interval: [480, 590], from, to, except: new Set(except) }],
  });

describe("PersonSchedule: пара с периодом", () => {
  it("занят по понедельникам триместра, кроме праздника; до и после — свободен", () => {
    const person = lecture("2026-09-07", "2026-11-09", ["2026-10-26"]);
    expect(person.busyOn("2026-09-07")).toEqual([[480, 590]]);
    expect(person.busyOn("2026-10-19")).toEqual([[480, 590]]);
    expect(person.busyOn("2026-10-26")).toEqual([]); // праздник
    expect(person.busyOn("2026-11-16")).toEqual([]); // триместр кончился
    expect(person.busyOn("2026-08-31")).toEqual([]); // ещё не начался
    expect(person.busyOn("2026-09-08")).toEqual([]); // вторник
  });
});

describe("cleanPeriod", () => {
  it("принимает период и исключения внутри него, по порядку и без повторов", () => {
    expect(
      cleanPeriod({ from: "2026-09-07", to: "2026-11-14", except: ["2026-11-02", "2026-10-26", "2026-11-02", "2027-01-01"] }),
    ).toEqual({ from: "2026-09-07", to: "2026-11-14", except: ["2026-10-26", "2026-11-02"] });
  });

  it("кривой период отбрасывается — пара остаётся еженедельной", () => {
    expect(cleanPeriod({ from: "2026-11-14", to: "2026-09-07" })).toEqual({});
    expect(cleanPeriod({ from: "07.09.2026", to: "2026-11-14" })).toEqual({});
    expect(cleanPeriod({ from: "2026-01-01", to: "2028-01-01" })).toEqual({});
    expect(cleanPeriod({})).toEqual({});
  });

  it("приходит с сайта вместе с парой и переживает правку клеток", () => {
    const [slot] = cleanIncomingSlots([
      { weekday: 0, start: 480, end: 590, label: "ВП", kind: "lecture", from: "2026-09-07", to: "2026-11-14", except: ["2026-10-26"] },
    ]);
    expect(slot).toMatchObject({ from: "2026-09-07", to: "2026-11-14", except: ["2026-10-26"] });
    const periods = [
      { n: 1, start: 480, end: 530, breakBefore: 0 },
      { n: 2, start: 540, end: 590, breakBefore: 10 },
      { n: 3, start: 600, end: 650, breakBefore: 10 },
    ];
    // Человек закрасил третью пару — у недельной пары из кампуса период остался.
    const cells = new Set(["0:480", "0:540", "0:600"]);
    const saved = editorSlots(periods, [slot!], cells);
    expect(saved.find((item) => item.start === 480)).toMatchObject({ from: "2026-09-07", to: "2026-11-14" });
    expect(saved.find((item) => item.start === 600)?.from).toBeUndefined();
  });
});

describe("запись и чтение", () => {
  beforeAll(async () => {
    await startTestDb();
  });

  it("период и исключения доходят от сохранения до расчёта свободного времени", async () => {
    const repo = await import("@/db/repo");
    await repo.upsertUser({ userId: 601, username: null, fullName: "Дана" });
    await repo.replaceWeeklySlots(
      601,
      [0, 1, 2, 3, 4, 5, 6],
      [
        { weekday: 0, start: 480, end: 590, kind: "lecture", from: "2026-09-07", to: "2026-11-09", except: ["2026-10-26"] },
        { weekday: 2, start: 600, end: 650, kind: "class" },
      ],
      "web",
    );
    const user = (await repo.getUser(601))!;
    const [person] = await repo.buildPersonSchedules([user]);
    expect(person!.busyOn("2026-10-19")).toEqual([[480, 590]]);
    expect(person!.busyOn("2026-10-26")).toEqual([]);
    expect(person!.busyOn("2026-11-16")).toEqual([]);
    expect(person!.busyOn("2026-11-18")).toEqual([[600, 650]]); // обычная пара — всегда

    // Повторное сохранение заменяет и пары с периодом (не копит дубли).
    await repo.replaceWeeklySlots(601, [0, 1, 2, 3, 4, 5, 6], [{ weekday: 1, start: 480, end: 530 }], "web");
    const [after] = await repo.buildPersonSchedules([user]);
    expect(after!.bounded).toHaveLength(0);
    expect(after!.busyOn("2026-10-19")).toEqual([]);
  });
});
