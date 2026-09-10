import { describe, expect, it } from "vitest";

import {
  coverageWindows,
  filterMinDuration,
  fmtInterval,
  fmtMinutes,
  intersect,
  intersectAll,
  invert,
  merge,
  normalize,
  totalMinutes,
  whoIsFree,
  type Interval,
} from "@/core/intervals";

describe("merge", () => {
  it("на пустом списке возвращает пустой", () => {
    expect(merge([])).toEqual([]);
  });

  it("сливает пересекающиеся", () => {
    expect(merge([[540, 630], [600, 700]])).toEqual([[540, 700]]);
  });

  it("9:00-10:00 и 10:00-11:00 — это один блок, окна в 10:00 быть не должно", () => {
    expect(merge([[540, 600], [600, 660]])).toEqual([[540, 660]]);
  });

  it("сортирует непересекающиеся", () => {
    expect(merge([[700, 800], [540, 600]])).toEqual([[540, 600], [700, 800]]);
  });

  it("выбрасывает вырожденные", () => {
    expect(merge([[600, 600], [540, 600]])).toEqual([[540, 600]]);
  });
});

describe("normalize", () => {
  it("обрезает по границам", () => {
    expect(normalize([[400, 700]], 480, 660)).toEqual([[480, 660]]);
  });

  it("выбрасывает то, что целиком вне окна", () => {
    expect(normalize([[100, 200]], 480, 1320)).toEqual([]);
  });
});

describe("invert", () => {
  it("даёт свободные промежутки", () => {
    expect(invert([[540, 630], [780, 870]], 480, 1320)).toEqual([
      [480, 540],
      [630, 780],
      [870, 1320],
    ]);
  });

  it("полностью занятый день не оставляет окон", () => {
    expect(invert([[480, 1320]], 480, 1320)).toEqual([]);
  });

  it("без занятости свободен весь день", () => {
    expect(invert([], 480, 1320)).toEqual([[480, 1320]]);
  });

  it("слот, выходящий за рабочее окно, обрезается, а не отбрасывается", () => {
    expect(invert([[420, 540]], 480, 1320)).toEqual([[540, 1320]]);
  });
});

describe("intersect", () => {
  it("пересекает два набора", () => {
    const a: Interval[] = [[480, 600], [700, 900]];
    const b: Interval[] = [[540, 720], [800, 1000]];
    expect(intersect(a, b)).toEqual([[540, 600], [700, 720], [800, 900]]);
  });

  it("касание не даёт пересечения", () => {
    expect(intersect([[480, 600]], [[600, 700]])).toEqual([]);
  });

  it("пустой набор людей — не «все свободны», а пустой результат", () => {
    expect(intersectAll([], 480, 1320)).toEqual([]);
  });

  it("пересекает три набора", () => {
    const groups: Interval[][] = [
      [[480, 720], [780, 1320]],
      [[540, 700], [800, 1000]],
      [[560, 690], [820, 960]],
    ];
    expect(intersectAll(groups, 480, 1320)).toEqual([[560, 690], [820, 960]]);
  });
});

describe("прочие помощники", () => {
  it("отсеивает короткие окна", () => {
    expect(filterMinDuration([[480, 500], [600, 700]], 30)).toEqual([[600, 700]]);
  });

  it("считает суммарные минуты", () => {
    expect(totalMinutes([[480, 540], [600, 630]])).toBe(90);
  });

  it("форматирует время", () => {
    expect(fmtMinutes(540)).toBe("09:00");
    expect(fmtMinutes(0)).toBe("00:00");
    expect(fmtMinutes(1439)).toBe("23:59");
    expect(fmtMinutes(1440)).toBe("24:00");
    expect(fmtInterval([540, 630])).toBe("09:00–10:30");
  });
});

describe("кворум: сколько человек свободно одновременно", () => {
  const a: Interval[] = [[480, 600], [700, 900]];
  const b: Interval[] = [[540, 720]];
  const c: Interval[] = [[560, 690]];

  it("при пороге «все» остаётся только общее пересечение", () => {
    expect(coverageWindows([a, b, c], 3)).toEqual([[[560, 600], 3]]);
  });

  it("при меньшем пороге склеивает смежные участки", () => {
    expect(coverageWindows([a, b, c], 2)).toEqual([
      [[540, 690], 2],
      [[700, 720], 2],
    ]);
  });

  it("возвращает минимальный счётчик по окну", () => {
    const x: Interval[] = [[480, 900]];
    const y: Interval[] = [[480, 900]];
    const z: Interval[] = [[600, 700]];
    expect(coverageWindows([x, y, z], 2)).toEqual([[[480, 900], 2]]);
  });

  it("нулевой порог даёт пустой результат", () => {
    expect(coverageWindows([[[480, 600]]], 0)).toEqual([]);
  });

  it("пустой набор даёт пустой результат", () => {
    expect(coverageWindows([], 1)).toEqual([]);
  });
});

describe("whoIsFree", () => {
  it("требует свободы на всём окне целиком", () => {
    const free = new Map<number, Interval[]>([
      [1, [[480, 900]]],
      [2, [[480, 600]]],
      [3, [[500, 900]]],
    ]);
    expect(whoIsFree(free, [520, 580])).toEqual([1, 2, 3]);
    expect(whoIsFree(free, [480, 900])).toEqual([1]);
  });
});
