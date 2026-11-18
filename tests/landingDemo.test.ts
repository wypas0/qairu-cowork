import { describe, expect, it } from "vitest";

import {
  ALL_IDS,
  DAYS,
  DEMO_PEOPLE,
  DEMO_PERIODS,
  PERIODS,
  bestWindow,
  freeCounts,
  freeOfAll,
  heatClass,
} from "@/core/landingDemo";

const without = (id: number) => new Set([...ALL_IDS].filter((other) => other !== id));

describe("демо лендинга: данные", () => {
  it("восемь человек, у каждого матрица 6 пар × 5 дней", () => {
    expect(DEMO_PEOPLE).toHaveLength(8);
    expect(DEMO_PERIODS).toHaveLength(PERIODS);
    for (const person of DEMO_PEOPLE) {
      expect(person.busy).toHaveLength(PERIODS);
      for (const row of person.busy) expect(row).toHaveLength(DAYS);
    }
    expect(new Set(DEMO_PEOPLE.map((person) => person.name)).size).toBe(8);
  });

  it("свободные в клетках складываются из свободных клеток каждого", () => {
    for (const active of [ALL_IDS, without(0), new Set([1, 4, 6])]) {
      const counts = freeCounts(active);
      const total = counts.flat().reduce((sum, count) => sum + count, 0);
      const perPerson = DEMO_PEOPLE.filter((person) => active.has(person.id)).reduce(
        (sum, person) => sum + person.busy.flat().filter((busy) => !busy).length,
        0,
      );
      expect(total).toBe(perPerson);
      expect(counts.flat().every((count) => count >= 0 && count <= active.size)).toBe(true);
    }
  });

  it("одинаковые входы — одинаковый ответ, входной набор не меняется", () => {
    const active = new Set([0, 2, 5]);
    expect(freeCounts(active)).toEqual(freeCounts(new Set([5, 2, 0])));
    expect(bestWindow(active)).toEqual(bestWindow(new Set(active)));
    expect([...active]).toEqual([0, 2, 5]);
  });
});

describe("демо лендинга: лучшее окно", () => {
  it("при всех восьми — Ср, 5 пара, 12:10–13:00, свободны все, и это единственная такая клетка", () => {
    expect(bestWindow(ALL_IDS)).toEqual({ period: 4, day: 2, count: 8 });
    expect(DEMO_PERIODS[4]).toEqual({ n: 5, start: "12:10", end: "13:00" });
    expect(freeCounts(ALL_IDS).flat().filter((count) => count === 8)).toHaveLength(1);
    expect(freeOfAll(4, 2)).toBe(8);
  });

  it("если не считать одного человека, окно переезжает хотя бы у трёх из восьми", () => {
    const moved = DEMO_PEOPLE.filter((person) => {
      const best = bestWindow(without(person.id))!;
      return best.period !== 4 || best.day !== 2;
    });
    expect(moved.length).toBeGreaterThanOrEqual(3);
    // Там, куда окно переехало, свободны все, кого считаем, — а из восьми не хватает именно его.
    for (const person of moved) {
      const best = bestWindow(without(person.id))!;
      expect(best.count).toBe(7);
      expect(person.busy[best.period][best.day]).toBe(true);
      expect(freeOfAll(best.period, best.day)).toBe(7);
    }
  });

  it("при равенстве выигрывает более ранний день, затем более ранняя пара", () => {
    // Без Амира свободны все семь и в Пн на 1 паре, и в Ср на 5-й: берётся понедельник.
    expect(bestWindow(without(0))).toEqual({ period: 0, day: 0, count: 7 });
    // Один человек: первая его свободная клетка по дням, затем по парам.
    const solo = DEMO_PEOPLE[1];
    const first = bestWindow(new Set([solo.id]))!;
    expect(first.count).toBe(1);
    for (let day = 0; day < first.day; day += 1) {
      for (let period = 0; period < PERIODS; period += 1) expect(solo.busy[period][day]).toBe(true);
    }
    for (let period = 0; period < first.period; period += 1) expect(solo.busy[period][first.day]).toBe(true);
  });

  it("пустой набор: все клетки нулевые, окна нет", () => {
    expect(freeCounts(new Set()).flat().every((count) => count === 0)).toBe(true);
    expect(bestWindow(new Set())).toBeNull();
  });
});

describe("демо лендинга: ступени карты", () => {
  it("как на карте группы: все — h0, никого — h5, доли между ними", () => {
    expect(heatClass(8, 8)).toBe("h0");
    expect(heatClass(7, 7)).toBe("h0");
    expect(heatClass(7, 8)).toBe("h1");
    expect(heatClass(6, 8)).toBe("h2");
    expect(heatClass(4, 5)).toBe("h1");
    expect(heatClass(3, 5)).toBe("h2");
    expect(heatClass(2, 5)).toBe("h3");
    expect(heatClass(1, 8)).toBe("h4");
    expect(heatClass(0, 8)).toBe("h5");
    expect(heatClass(0, 0)).toBe("h5");
  });
});

describe("лендинг: тексты", () => {
  it("заголовок, описание и og:locale — на языке посетителя (Р18)", async () => {
    const { landingMetadata } = await import("@/components/landing/meta");
    const ru = landingMetadata("ru");
    expect(ru.title).toBe("QairuCowork — общее окно для всей группы");
    expect(ru.description).toBeTruthy();
    expect(ru.openGraph).toMatchObject({ type: "website", siteName: "QairuCowork", locale: "ru_RU", title: ru.title });
    expect(landingMetadata("kk").openGraph).toMatchObject({ locale: "kk_KZ" });
    expect(landingMetadata("en").openGraph).toMatchObject({ locale: "en_US" });
    expect(landingMetadata("en").title).not.toBe(ru.title);
    // Незнакомый язык — как везде на сайте, русский.
    expect(landingMetadata("de").openGraph).toMatchObject({ locale: "ru_RU" });
  });

  it("кнопки приглашения в плитке — те же слова, что шлёт бот, без эмодзи", async () => {
    const { LANGS } = await import("@/i18n");
    const bare = (text: string) => text.replace(/^\P{L}+/u, "").trim();
    for (const [lang, dict] of Object.entries(LANGS)) {
      expect(dict.w_l_bot_yes, lang).toBe(bare(dict.btn_yes));
      expect(dict.w_l_bot_maybe, lang).toBe(bare(dict.btn_maybe));
      expect(dict.w_l_bot_no, lang).toBe(bare(dict.btn_no_answer));
    }
  });

  it("лендинг не обещает того, от чего отказались: голосование, Zoom, фото, общее расписание, «бесплатно»", async () => {
    const { LANGS } = await import("@/i18n");
    const banned = /голосов|дауыс|vot(e|ing)|zoom|фото|сурет|photo|общее расписание|ортақ кесте|shared schedule|бесплатн|тегін|free of charge|for free/i;
    for (const [lang, dict] of Object.entries(LANGS)) {
      for (const [key, text] of Object.entries(dict)) {
        if (key.startsWith("w_l_")) expect(`${lang}.${key}: ${text}`).not.toMatch(banned);
      }
    }
  });

  it("в строках лендинга нет эмодзи", async () => {
    const { LANGS } = await import("@/i18n");
    for (const [lang, dict] of Object.entries(LANGS)) {
      for (const [key, text] of Object.entries(dict)) {
        if (key.startsWith("w_l_")) expect(`${lang}.${key}: ${text}`).not.toMatch(/\p{Extended_Pictographic}/u);
      }
    }
  });
});
