import { describe, expect, it } from "vitest";

import { LANGS, tn } from "@/i18n";
import { RU } from "@/i18n/ru";

const placeholders = (text: string) =>
  [...text.matchAll(/\{(\w+)\}/g)]
    .map((match) => match[1])
    .sort()
    .join(",");

describe("переводы", () => {
  it("в казахском и английском те же подстановки, что в русском", () => {
    // Ключи сверяет компилятор (тип Dict), а подстановки — только этот тест:
    // забытый {name} в переводе молча выкинул бы имя из сообщения.
    for (const [lang, dict] of Object.entries(LANGS)) {
      for (const [key, text] of Object.entries(RU)) {
        expect(`${lang}.${key}: ${placeholders(dict[key] ?? "")}`).toBe(`${lang}.${key}: ${placeholders(text)}`);
      }
    }
  });

  it("у каждой строки с числом есть все формы языка", () => {
    // Строка с числом узнаётся по паре форм _one и _few: просто «_one» в конце
    // бывает и у обычных ключей («напомнить одному»).
    const keys = new Set(Object.keys(RU));
    const plurals = [...keys]
      .filter((key) => key.endsWith("_one") && keys.has(`${key.slice(0, -4)}_few`))
      .map((key) => key.slice(0, -4));
    expect(plurals.length).toBeGreaterThan(0);
    for (const dict of Object.values(LANGS)) {
      for (const base of plurals) {
        for (const form of ["one", "few", "many", "other"]) expect(dict[`${base}_${form}`]).toBeTruthy();
      }
    }
  });

  it("выбирает форму по правилам языка", () => {
    expect(tn("ru", "w_meetings_count", 1)).toBe("1 встреча");
    expect(tn("ru", "w_meetings_count", 3)).toBe("3 встречи");
    expect(tn("ru", "w_meetings_count", 5)).toBe("5 встреч");
    expect(tn("ru", "w_meetings_count", 21)).toBe("21 встреча");
    expect(tn("en", "w_meetings_count", 1)).toBe("1 meeting");
    expect(tn("en", "w_meetings_count", 2)).toBe("2 meetings");
    expect(tn("kk", "w_meetings_count", 4)).toBe("4 кездесу");
  });
});

describe("страница ошибки", () => {
  it("язык по коду браузера, незнакомый — русский", async () => {
    const { ERROR_TEXT, errorText } = await import("@/i18n/errorText");
    expect(errorText("kk-KZ")).toBe(ERROR_TEXT.kk);
    expect(errorText("en")).toBe(ERROR_TEXT.en);
    expect(errorText("de-DE")).toBe(ERROR_TEXT.ru);
    expect(errorText(undefined)).toBe(ERROR_TEXT.ru);
  });
});
