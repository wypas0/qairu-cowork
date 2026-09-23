import { describe, expect, it } from "vitest";

import {
  PersonSchedule,
  anyWindows,
  computeAvailability,
  freeWindowsForDay,
  heatmap,
  parityFromIsoWeek,
  parityFromSemesterStart,
  slotsOfLength,
  topSlots,
  type DateRangeSlot,
  type Window,
} from "@/core/availability";
import type { Interval } from "@/core/intervals";
import type { DateStr } from "@/core/timeutils";

const MONDAY = "2026-09-07";
const TUESDAY = "2026-09-08";
const NEXT_MONDAY = "2026-09-14";

function person(
  userId: number,
  options: {
    weekly?: Record<number, Interval[]>;
    dated?: Record<DateStr, Interval[]>;
    parity?: Record<number, Record<number, Interval[]>>;
    ranges?: DateRangeSlot[];
    hasData?: boolean;
  } = {},
): PersonSchedule {
  const weeklyParity = new Map<number, Map<number, Interval[]>>();
  for (const [key, days] of Object.entries(options.parity ?? {})) {
    weeklyParity.set(
      Number(key),
      new Map(Object.entries(days).map(([day, list]) => [Number(day), list])),
    );
  }
  return new PersonSchedule({
    userId,
    name: `u${userId}`,
    weekly: new Map(
      Object.entries(options.weekly ?? {}).map(([day, list]) => [Number(day), list]),
    ),
    weeklyParity,
    dated: new Map(Object.entries(options.dated ?? {})),
    ranges: options.ranges ?? [],
    hasData: options.hasData ?? true,
  });
}

function intervals(windows: Window[]): Interval[] {
  return windows.map((window) => window.interval);
}

describe("базовые окна", () => {
  it("свободное время одного человека", () => {
    const amir = person(1, { weekly: { 0: [[540, 630], [780, 870]] } });
    expect(intervals(freeWindowsForDay([amir], MONDAY, 480, 1320, 30))).toEqual([
      [480, 540],
      [630, 780],
      [870, 1320],
    ]);
  });

  it("пересечение двух расписаний", () => {
    const a = person(1, { weekly: { 0: [[540, 630]] } });
    const b = person(2, { weekly: { 0: [[600, 720]] } });
    expect(intervals(freeWindowsForDay([a, b], MONDAY, 480, 1320, 30))).toEqual([
      [480, 540],
      [720, 1320],
    ]);
  });

  it("короткие промежутки отсеиваются", () => {
    const a = person(1, { weekly: { 0: [[540, 630], [650, 780]] } });
    expect(freeWindowsForDay([a], MONDAY, 540, 780, 30)).toEqual([]);
  });

  it("без людей окон нет", () => {
    expect(freeWindowsForDay([], MONDAY, 480, 1320, 30)).toEqual([]);
  });

  it("человек без расписания исключается и попадает в «не заполнили»", () => {
    const a = person(1, { weekly: { 0: [[540, 630]] } });
    const b = person(2, { hasData: false });
    const result = computeAvailability([a, b], MONDAY, {
      daysAhead: 1,
      dayStart: 480,
      dayEnd: 1320,
    });
    expect(result.participants.map((p) => p.userId)).toEqual([1]);
    expect(result.missing.map((p) => p.userId)).toEqual([2]);
    expect(intervals(result.days[0].windows)).toEqual([[480, 540], [630, 1320]]);
  });

  it("окно перечисляет тех, кто в нём свободен", () => {
    const a = person(1, { weekly: { 0: [[540, 630]] } });
    const b = person(2, { weekly: { 0: [[540, 630]] } });
    const windows = freeWindowsForDay([a, b], MONDAY, 480, 1320, 30);
    expect(windows[0].freeIds).toEqual([1, 2]);
  });

  it("неделя вперёд — это семь дней", () => {
    const a = person(1, { weekly: { 0: [[480, 1320]] } });
    const result = computeAvailability([a], MONDAY, {
      daysAhead: 7,
      dayStart: 480,
      dayEnd: 1320,
    });
    expect(result.days).toHaveLength(7);
    expect(result.days[0].windows).toEqual([]);
    expect(intervals(result.days[1].windows)).toEqual([[480, 1320]]);
  });

  it("полностью занятая неделя не даёт окон", () => {
    const weekly: Record<number, Interval[]> = {};
    for (let day = 0; day < 7; day += 1) weekly[day] = [[480, 1320]];
    const result = computeAvailability([person(1, { weekly })], MONDAY, {
      daysAhead: 7,
      dayStart: 480,
      dayEnd: 1320,
    });
    expect(anyWindows(result)).toBe(false);
  });

  it("границы рабочего окна соблюдаются", () => {
    const a = person(1, { weekly: { 0: [[0, 24 * 60]] } });
    const result = computeAvailability([a], MONDAY, {
      daysAhead: 1,
      dayStart: 480,
      dayEnd: 1320,
    });
    expect(result.days[0].windows).toEqual([]);
  });
});

describe("разовая занятость и диапазоны дат", () => {
  it("разовый слот действует только в свой день", () => {
    const a = person(1, { weekly: { 1: [[540, 600]] }, dated: { [TUESDAY]: [[600, 720]] } });
    const result = computeAvailability([a], TUESDAY, {
      daysAhead: 1,
      dayStart: 480,
      dayEnd: 1320,
    });
    expect(intervals(result.days[0].windows)).toEqual([[480, 540], [720, 1320]]);
  });

  it("сессия 7–9 сентября занимает все дни внутри себя", () => {
    const a = person(1, {
      ranges: [{ dateFrom: MONDAY, dateTo: "2026-09-09", start: 0, end: 24 * 60 }],
    });
    const result = computeAvailability([a], MONDAY, {
      daysAhead: 5,
      dayStart: 480,
      dayEnd: 1320,
    });
    expect(result.days[0].windows).toEqual([]); // 07.09
    expect(result.days[1].windows).toEqual([]); // 08.09
    expect(result.days[2].windows).toEqual([]); // 09.09
    expect(intervals(result.days[3].windows)).toEqual([[480, 1320]]); // 10.09
  });

  it("диапазон с часами оставляет вечер свободным", () => {
    const a = person(1, {
      ranges: [{ dateFrom: MONDAY, dateTo: "2026-09-09", start: 540, end: 840 }],
    });
    const result = computeAvailability([a], MONDAY, {
      daysAhead: 1,
      dayStart: 480,
      dayEnd: 1320,
    });
    expect(intervals(result.days[0].windows)).toEqual([[480, 540], [840, 1320]]);
  });
});

describe("чётность недель", () => {
  it("считается от начала семестра", () => {
    const parityOf = parityFromSemesterStart("2026-09-01"); // вторник 1-й недели
    expect(parityOf("2026-09-01")).toBe(0); // числитель
    expect(parityOf("2026-09-07")).toBe(1); // следующая неделя — знаменатель
    expect(parityOf("2026-09-14")).toBe(0); // снова числитель
  });

  it("запасной вариант по ISO-неделе чередуется", () => {
    expect(parityFromIsoWeek("2026-09-07")).not.toBe(parityFromIsoWeek("2026-09-14"));
    expect(parityFromIsoWeek("2026-09-07")).toBe(parityFromIsoWeek("2026-09-13"));
  });

  it("слот по чётности действует только на своей неделе", () => {
    const a = person(1, { parity: { 0: { 0: [[600, 720]] } } }); // пара только по числителю
    const parityOf = parityFromSemesterStart("2026-09-01");

    const busyWeek = computeAvailability([a], NEXT_MONDAY, {
      daysAhead: 1,
      dayStart: 480,
      dayEnd: 1320,
      parityOf,
    });
    const freeWeek = computeAvailability([a], MONDAY, {
      daysAhead: 1,
      dayStart: 480,
      dayEnd: 1320,
      parityOf,
    });
    expect(intervals(busyWeek.days[0].windows)).toEqual([[480, 600], [720, 1320]]);
    expect(intervals(freeWeek.days[0].windows)).toEqual([[480, 1320]]);
  });

  it("без начала семестра чётность неизвестна — такие пары не учитываются", () => {
    const a = person(1, { parity: { 0: { 0: [[600, 720]] } } });
    const result = computeAvailability([a], MONDAY, {
      daysAhead: 1,
      dayStart: 480,
      dayEnd: 1320,
    });
    expect(intervals(result.days[0].windows)).toEqual([[480, 1320]]);
  });
});

describe("буфер на дорогу", () => {
  it("сжимает окна с обеих сторон", () => {
    const a = person(1, { weekly: { 0: [[600, 720]] } });
    const result = computeAvailability([a], MONDAY, {
      daysAhead: 1,
      dayStart: 480,
      dayEnd: 1320,
      bufferMin: 15,
    });
    expect(intervals(result.days[0].windows)).toEqual([[480, 585], [735, 1320]]);
  });

  it("может схлопнуть короткое окно между парами", () => {
    const a = person(1, { weekly: { 0: [[540, 600], [630, 720]] } }); // окно 10:00–10:30
    const result = computeAvailability([a], MONDAY, {
      daysAhead: 1,
      dayStart: 480,
      dayEnd: 1320,
      minSlot: 30,
      bufferMin: 20,
    });
    expect(intervals(result.days[0].windows)).not.toContainEqual([600, 630]);
  });
});

describe("кворум", () => {
  it("находит окно, когда занят один человек", () => {
    const a = person(1, { weekly: { 0: [[600, 720]] } });
    const b = person(2);
    const c = person(3);

    const everyone = computeAvailability([a, b, c], MONDAY, {
      daysAhead: 1,
      dayStart: 600,
      dayEnd: 720,
      minSlot: 30,
    });
    expect(everyone.days[0].windows).toEqual([]);
    expect(everyone.everyone).toBe(true);

    const quorum = computeAvailability([a, b, c], MONDAY, {
      daysAhead: 1,
      dayStart: 600,
      dayEnd: 720,
      minSlot: 30,
      quorum: 2,
    });
    expect(intervals(quorum.days[0].windows)).toEqual([[600, 720]]);
    expect(quorum.days[0].windows[0].freeIds).toEqual([2, 3]);
    expect(quorum.everyone).toBe(false);
  });

  it("кворум выше размера группы зажимается до «нужны все»", () => {
    const result = computeAvailability([person(1)], MONDAY, {
      daysAhead: 1,
      dayStart: 480,
      dayEnd: 1320,
      quorum: 99,
    });
    expect(result.quorum).toBe(1);
    expect(result.everyone).toBe(true);
  });

  it("кворум, равный размеру группы, совпадает с пересечением", () => {
    const a = person(1, { weekly: { 0: [[540, 630]] } });
    const b = person(2, { weekly: { 0: [[600, 720]] } });
    const strict = computeAvailability([a, b], MONDAY, {
      daysAhead: 1,
      dayStart: 480,
      dayEnd: 1320,
    });
    const same = computeAvailability([a, b], MONDAY, {
      daysAhead: 1,
      dayStart: 480,
      dayEnd: 1320,
      quorum: 2,
    });
    expect(intervals(strict.days[0].windows)).toEqual(intervals(same.days[0].windows));
  });
});

describe("слоты для кнопок встречи", () => {
  it("соблюдают лимит и хронологию", () => {
    const result = computeAvailability([person(1)], MONDAY, {
      daysAhead: 7,
      dayStart: 480,
      dayEnd: 1320,
    });
    const slots = topSlots(result, 3);
    expect(slots).toHaveLength(3);
    expect(slots[0].day).toBe(MONDAY);
    expect(slots[1].day).toBe(TUESDAY);
  });
});

describe("тепловая карта", () => {
  it("клетка свободна, только если человек свободен на всём её протяжении", () => {
    const a = person(1, { weekly: { 0: [[600, 615]] } }); // занят половину клетки 10:00–10:30
    const b = person(2);
    const grid = heatmap([a, b], MONDAY, {
      daysAhead: 1,
      dayStart: 540,
      dayEnd: 660,
      step: 30,
    });
    const cell = grid[0].cells.find((item) => item.startMin === 600)!;
    expect(cell.freeIds).toEqual([2]);
  });

  it("покрывает рабочее окно целиком", () => {
    const grid = heatmap([person(1)], MONDAY, {
      daysAhead: 2,
      dayStart: 480,
      dayEnd: 600,
      step: 30,
    });
    expect(grid).toHaveLength(2);
    expect(grid[0].cells.map((cell) => cell.startMin)).toEqual([480, 510, 540, 570]);
  });
});

describe("варианты встречи ровно заданной длины", () => {
  it("режет свободное время на отрезки выбранной длины с шагом сетки", () => {
    // Свободен 10:00–12:00 и 15:00–16:30, остальное занято.
    const amir = person(1, { weekly: { 0: [[480, 600], [720, 900], [990, 1320]] } });
    const { days } = slotsOfLength([amir], MONDAY, {
      daysAhead: 1,
      dayStart: 480,
      dayEnd: 1320,
      duration: 60,
    });
    expect(days[0].slots.map((slot) => slot.interval)).toEqual([
      [600, 660],
      [630, 690],
      [660, 720],
      [900, 960],
      [930, 990],
    ]);
  });

  it("не предлагает вариант, который выходит за конец рабочего дня", () => {
    const amir = person(1, { weekly: {} });
    const { days } = slotsOfLength([amir], MONDAY, {
      daysAhead: 1,
      dayStart: 1200,
      dayEnd: 1320,
      duration: 90,
    });
    expect(days[0].slots.map((slot) => slot.interval)).toEqual([
      [1200, 1290],
      [1230, 1320],
    ]);
  });

  it("при кворуме состав свободных считается для каждого варианта отдельно", () => {
    const amir = person(1, { weekly: { 0: [[660, 720]] } }); // занят 11:00–12:00
    const asel = person(2, { weekly: { 0: [[600, 660]] } }); // занята 10:00–11:00
    const { days, quorum, everyone } = slotsOfLength([amir, asel], MONDAY, {
      daysAhead: 1,
      dayStart: 600,
      dayEnd: 720,
      duration: 60,
      quorum: 1,
    });
    expect(quorum).toBe(1);
    expect(everyone).toBe(false);
    const byStart = new Map(days[0].slots.map((slot) => [slot.interval[0], slot.freeIds]));
    expect(byStart.get(600)).toEqual([1]);
    // 10:30–11:30: Амир занят с 11:00, Асель — до 11:00, весь час не свободен никто.
    expect(byStart.has(630)).toBe(false);
    expect(byStart.get(660)).toEqual([2]);
  });

  it("без кворума нужны все, и разовая занятость на дату учитывается", () => {
    const amir = person(1, { weekly: {} });
    const asel = person(2, { weekly: {}, dated: { [TUESDAY]: [[480, 1320]] } });
    const { days } = slotsOfLength([amir, asel], MONDAY, {
      daysAhead: 2,
      dayStart: 480,
      dayEnd: 600,
      duration: 120,
    });
    expect(days[0].slots.map((slot) => slot.freeIds)).toEqual([[1, 2]]);
    expect(days[1].day).toBe(TUESDAY);
    expect(days[1].slots).toEqual([]);
  });

  it("люди без заполненного расписания не участвуют и не блокируют варианты", () => {
    const amir = person(1, { weekly: {} });
    const ghost = person(2, { hasData: false });
    const { days, participants } = slotsOfLength([amir, ghost], MONDAY, {
      daysAhead: 1,
      dayStart: 480,
      dayEnd: 540,
      duration: 30,
    });
    expect(participants.map((p) => p.userId)).toEqual([1]);
    expect(days[0].slots).toHaveLength(2);
  });
});

describe("нежелательное время", () => {
  // Асель занята с 9 до 10, а 12:00–14:00 ей неудобно, но она свободна.
  const asel = new PersonSchedule({
    userId: 1,
    name: "Асель",
    weekly: new Map([[0, [[540, 600] as Interval]]]),
    softWeekly: new Map([[0, [[720, 840] as Interval]]]),
  });
  const bolat = new PersonSchedule({ userId: 2, name: "Болат" });

  it("не делает человека занятым", () => {
    expect(asel.busyOn(MONDAY)).toEqual([[540, 600]]);
    expect(asel.softOn(MONDAY)).toEqual([[720, 840]]);
    expect(asel.softOn(TUESDAY)).toEqual([]);
  });

  it("клетка знает, кому из свободных она неудобна", () => {
    const [day] = heatmap([asel, bolat], MONDAY, {
      daysAhead: 1,
      rows: [
        { start: 660, end: 720 },
        { start: 720, end: 780 },
      ],
    });
    expect(day.cells[0]).toMatchObject({ freeIds: [1, 2], softIds: [] });
    expect(day.cells[1]).toMatchObject({ freeIds: [1, 2], softIds: [1] });
  });

  it("вариант встречи тоже", () => {
    const { days } = slotsOfLength([asel, bolat], MONDAY, { daysAhead: 1, duration: 60, step: 60, dayStart: 660, dayEnd: 840 });
    expect(days[0].slots.map((slot) => [slot.interval[0], slot.softIds])).toEqual([
      [660, []],
      [720, [1]],
      [780, [1]],
    ]);
  });
});
