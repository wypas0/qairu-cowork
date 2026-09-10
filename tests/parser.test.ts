import { describe, expect, it } from "vitest";

import {
  type ParseResult,
  findKind,
  findParity,
  isAllDay,
  parseAny,
  parseScheduleCsv,
  parseScheduleText,
} from "@/core/parser";

function slotsOf(result: ParseResult, weekday: number): [number, number][] {
  return result.slots
    .filter((slot) => slot.weekday === weekday)
    .map((slot) => [slot.startMin, slot.endMin] as [number, number])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

describe("дни недели", () => {
  it("русские сокращения", () => {
    const result = parseScheduleText("Пн 9:00-10:30\nВт 13:00-14:30");
    expect(slotsOf(result, 0)).toEqual([[540, 630]]);
    expect(slotsOf(result, 1)).toEqual([[780, 870]]);
  });

  it("русские полные формы", () => {
    const result = parseScheduleText("понедельник 9-10:30\nсреда 12:00-13:30");
    expect(slotsOf(result, 0)).toEqual([[540, 630]]);
    expect(slotsOf(result, 2)).toEqual([[720, 810]]);
  });

  it("«Сенбі» не срабатывает внутри «Дүйсенбі» или «Бейсенбі»", () => {
    const result = parseScheduleText(
      "Дүйсенбі 9:00-10:30\nБейсенбі 11:00-12:30\nСенбі 14:00-15:30",
    );
    expect(slotsOf(result, 0)).toEqual([[540, 630]]); // дүйсенбі = понедельник
    expect(slotsOf(result, 3)).toEqual([[660, 750]]); // бейсенбі = четверг
    expect(slotsOf(result, 5)).toEqual([[840, 930]]); // сенбі = суббота
  });

  it("английские дни", () => {
    const result = parseScheduleText("Monday 9:00-10:30\nfri 15:00-16:00");
    expect(slotsOf(result, 0)).toEqual([[540, 630]]);
    expect(slotsOf(result, 4)).toEqual([[900, 960]]);
  });

  it("день переносится на следующие строки", () => {
    const result = parseScheduleText("Пн\n9:00-10:30\n13:00-14:00");
    expect(slotsOf(result, 0)).toEqual([[540, 630], [780, 840]]);
  });

  it("«ежедневно» раскрывается в семь дней", () => {
    expect(parseScheduleText("ежедневно 9:00-10:00").slots).toHaveLength(7);
  });
});

describe("форматы времени", () => {
  it("несколько диапазонов в одной строке с подписями", () => {
    const result = parseScheduleText("Пн 9:00-10:30 Матан, 13:00-14:30 История");
    expect(slotsOf(result, 0)).toEqual([[540, 630], [780, 870]]);
    expect(result.slots.map((slot) => slot.label)).toEqual(["Матан", "История"]);
  });

  it("точки и точки с запятой", () => {
    const result = parseScheduleText("Чт 10-11.30; 12:00-13:30");
    expect(slotsOf(result, 3)).toEqual([[600, 690], [720, 810]]);
  });

  it("короткое и длинное тире", () => {
    const result = parseScheduleText("Вт 8:00–9:30\nСр 10:00—11:00");
    expect(slotsOf(result, 1)).toEqual([[480, 570]]);
    expect(slotsOf(result, 2)).toEqual([[600, 660]]);
  });

  it("некорректное время игнорируется", () => {
    expect(slotsOf(parseScheduleText("Пн 25:00-26:00"), 0)).toEqual([]);
  });
});

describe("особые строки", () => {
  it("свободный день помечается отдельно", () => {
    const result = parseScheduleText("Ср нет пар");
    expect(result.freeDays).toContain(2);
    expect(slotsOf(result, 2)).toEqual([]);
  });

  it("неразобранная строка попадает в ошибки", () => {
    const result = parseScheduleText("какая-то ерунда без времени");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.slots).toEqual([]);
  });

  it("«весь день» без времени занимает сутки", () => {
    const result = parseScheduleText("Вт весь день");
    expect(result.slots[0].startMin).toBe(0);
    expect(result.slots[0].endMin).toBe(24 * 60);
  });
});

describe("CSV", () => {
  it("с заголовком", () => {
    const text = "weekday,start,end,label\nПн,9:00,10:30,Матан\nВт,13:00,14:30,История\n";
    const result = parseScheduleCsv(text);
    expect(slotsOf(result, 0)).toEqual([[540, 630]]);
    expect(slotsOf(result, 1)).toEqual([[780, 870]]);
  });

  it("пятая колонка — чётность", () => {
    const text = "Пн,9:00,10:30,Матан,числитель\nВт,13:00,14:30,История,знаменатель\n";
    const result = parseScheduleCsv(text);
    expect(result.slots.map((slot) => slot.parity)).toEqual([0, 1]);
  });

  it("parseAny выбирает CSV, когда строки похожи на таблицу", () => {
    const text = "Пн,9:00,10:30,Матан\nВт,13:00,14:30,История\nСр,10:00,11:00,Физика\n";
    expect(parseAny(text).slots).toHaveLength(3);
  });

  it("parseAny выбирает текст, когда запятые — просто разделители", () => {
    const text = "Пн 9:00-10:30 Матан, 13:00-14:30 История\nВт 8:00-9:30";
    const result = parseAny(text);
    expect(slotsOf(result, 0)).toEqual([[540, 630], [780, 870]]);
    expect(slotsOf(result, 1)).toEqual([[480, 570]]);
  });
});

describe("чётность недель и типы занятости", () => {
  it("чётность определяется для каждого диапазона", () => {
    const result = parseScheduleText(
      "Пн 9:00-10:30 Матан (числитель), 13:00-14:30 История (знаменатель)",
    );
    const byStart = new Map(result.slots.map((slot) => [slot.startMin, slot]));
    expect(byStart.get(540)!.parity).toBe(0);
    expect(byStart.get(780)!.parity).toBe(1);
  });

  it("служебные слова вычищаются из подписи", () => {
    const result = parseScheduleText("Пн 9:00-10:30 Матан (числитель)");
    expect(result.slots[0].label).toBe("Матан");
  });

  it("чётность на уровне строки применяется ко всем диапазонам", () => {
    const result = parseScheduleText("Знаменатель: Ср 9:00-10:30, 11:00-12:30");
    expect(result.slots.every((slot) => slot.parity === 1)).toBe(true);
  });

  it("без указания чётности пара идёт каждую неделю", () => {
    expect(parseScheduleText("Пн 9:00-10:30 Матан").slots[0].parity).toBeNull();
  });

  it("тип занятости распознаётся по ключевым словам", () => {
    expect(findKind("18:00-22:00 работа")).toBe("work");
    expect(findKind("тренировка в зале")).toBe("sport");
    expect(findKind("экзамен по матану")).toBe("exam");
    expect(findKind("Матан")).toBe("class");
  });

  it("тип занятости сохраняется в слоте", () => {
    const result = parseScheduleText("Сб 18:00-22:00 работа");
    expect(result.slots[0].kind).toBe("work");
    expect(result.slots[0].startMin).toBe(1080);
  });

  it("вспомогательные функции", () => {
    expect(isAllDay("12.09 весь день")).toBe(true);
    expect(isAllDay("all day")).toBe(true);
    expect(isAllDay("14:00-16:00")).toBe(false);
    expect(findParity("odd week")).toBe(0);
    expect(findParity("even week")).toBe(1);
    expect(findParity("just a label")).toBeNull();
  });
});
