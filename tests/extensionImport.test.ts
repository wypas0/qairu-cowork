/**
 * Пары из расширения кампуса: сообщение со страницы проверяется так же строго,
 * как сохранение с сайта, — расширению (и любому скрипту на странице) не доверяем.
 */

import { describe, expect, it } from "vitest";

import {
  EXT_SOURCE,
  LATEST_EXTENSION,
  olderVersion,
  readExtensionMessage,
  readExtensionReport,
} from "@/core/extensionImport";

const message = (patch: Record<string, unknown> = {}) => ({
  source: EXT_SOURCE,
  type: "campus-slots",
  id: "3f0c1d9e-1111-4a2b-8c3d-000000000001",
  meetings: 24,
  slots: [
    { weekday: 0, start: 480, end: 590, label: "Введение в программирование", kind: "lecture", parity: null },
    { weekday: 3, start: 670, end: 840, label: "Основы математического анализа", kind: "practice", parity: null },
  ],
  ...patch,
});

describe("readExtensionMessage", () => {
  it("принимает пары расширения и подписывает время", () => {
    const result = readExtensionMessage(message());
    expect(result).toEqual({
      id: "3f0c1d9e-1111-4a2b-8c3d-000000000001",
      count: 24,
      slots: [
        {
          weekday: 0,
          start: 480,
          end: 590,
          label: "Введение в программирование",
          kind: "lecture",
          parity: null,
          text: "08:00–09:50",
        },
        {
          weekday: 3,
          start: 670,
          end: 840,
          label: "Основы математического анализа",
          kind: "practice",
          parity: null,
          text: "11:10–14:00",
        },
      ],
    });
  });

  it("чужие сообщения не трогает", () => {
    expect(readExtensionMessage(null)).toBeNull();
    expect(readExtensionMessage("campus-slots")).toBeNull();
    expect(readExtensionMessage(message({ source: "someone-else" }))).toBeNull();
    expect(readExtensionMessage(message({ type: "campus-ready" }))).toBeNull();
    expect(readExtensionMessage(message({ id: 42 }))).toBeNull();
    expect(readExtensionMessage(message({ id: "x".repeat(65) }))).toBeNull();
  });

  it("отбрасывает невалидные пары, а без валидных — ничего не показывает", () => {
    const result = readExtensionMessage(
      message({
        slots: [
          { weekday: 7, start: 480, end: 590, label: "день вне недели" },
          { weekday: 1, start: 600, end: 540, label: "конец раньше начала" },
          { weekday: 1, start: 600, end: 650, label: "ок" },
        ],
      }),
    );
    expect(result?.slots.map((slot) => slot.label)).toEqual(["ок"]);
    expect(readExtensionMessage(message({ slots: [{ weekday: 9 }] }))).toBeNull();
    expect(readExtensionMessage(message({ slots: "нет" }))).toBeNull();
  });

  it("вид пары — только из списка: «soft» не превращает пару в «неудобно»", () => {
    const result = readExtensionMessage(
      message({ slots: [{ weekday: 0, start: 480, end: 530, label: "A", kind: "soft" }] }),
    );
    expect(result?.slots[0]?.kind).toBe("other");
  });

  it("счётчик пар не меньше числа промежутков и в разумных пределах", () => {
    expect(readExtensionMessage(message({ meetings: 1 }))?.count).toBe(2);
    expect(readExtensionMessage(message({ meetings: 10_000 }))?.count).toBe(2);
    expect(readExtensionMessage(message({ meetings: undefined }))?.count).toBe(2);
  });

  it("не больше 80 пар и подписи без управляющих символов", () => {
    const many = Array.from({ length: 120 }, (_, i) => ({
      weekday: i % 7,
      start: 480 + (i % 10) * 60,
      end: 530 + (i % 10) * 60,
      label: "A\u0000B\nC",
    }));
    const result = readExtensionMessage(message({ slots: many, meetings: 120 }));
    expect(result?.slots).toHaveLength(80);
    expect(result?.slots[0]?.label).toBe("A B C");
  });
});

describe("readExtensionReport", () => {
  const report = { kind: "not_found", version: "0.2.0", locale: "ru", html: 180_000, flight: 150_000, grid: false, sections: 1 };

  it("принимает отчёт из чисел, флага и кодов", () => {
    expect(readExtensionReport(report)).toEqual(report);
  });

  it("свободный текст и лишнее в сообщение бота не попадают", () => {
    expect(readExtensionReport({ ...report, version: "<b>x</b>" })).toBeNull();
    expect(readExtensionReport({ ...report, locale: "de" })).toBeNull();
    expect(readExtensionReport({ ...report, kind: "hello" })).toBeNull();
    expect(readExtensionReport({ ...report, html: -1 })).toBeNull();
    expect(readExtensionReport({ ...report, sections: 1.5 })).toBeNull();
    expect(readExtensionReport({ ...report, grid: "no" })).toBeNull();
    expect(readExtensionReport({ ...report, extra: "<script>" })).toEqual(report);
    expect(readExtensionReport(null)).toBeNull();
  });
});

describe("olderVersion", () => {
  it("сравнивает по числам, а не строкам", () => {
    expect(olderVersion("0.1.0", "0.2.0")).toBe(true);
    expect(olderVersion("0.9.0", "0.10.0")).toBe(true);
    expect(olderVersion("0.2.0", "0.2.0")).toBe(false);
    expect(olderVersion("1.0.0", "0.9.9")).toBe(false);
    expect(olderVersion(LATEST_EXTENSION, LATEST_EXTENSION)).toBe(false);
  });
});
