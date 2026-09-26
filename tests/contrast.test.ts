/**
 * Контраст токенов темы по WCAG AA — прямо из src/styles/tokens.css.
 *
 * Текст — не ниже 4,5:1, обводки и значимые элементы — не ниже 3:1.
 * Полупрозрачные токены (стекло карточки, обводки) накладываются на фон
 * страницы; в тёмной теме фон — небо, поэтому проверяем и самое светлое его
 * место — свечение горизонта у подвала.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const CSS = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");

function block(selector: string): Record<string, string> {
  const start = CSS.indexOf(selector);
  if (start < 0) throw new Error(`нет блока ${selector}`);
  const open = CSS.indexOf("{", start);
  const close = CSS.indexOf("}", open);
  const tokens: Record<string, string> = {};
  for (const [, name, value] of CSS.slice(open + 1, close).matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    tokens[name] = value.trim();
  }
  return tokens;
}

const LIGHT = block(":root {");
const DARK_SYSTEM = block(':root:not([data-theme="light"]) {');
const DARK = { ...LIGHT, ...block(':root[data-theme="dark"] {') };

type Rgba = [number, number, number, number];

function parse(value: string): Rgba {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgba = value.match(/^rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\s*\)$/);
  if (rgba) return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), rgba[4] === undefined ? 1 : Number(rgba[4])];
  throw new Error(`не цвет: ${value}`);
}

function over(top: Rgba, under: Rgba): Rgba {
  const a = top[3];
  return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1];
}

function luminance([r, g, b]: Rgba): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratio(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** [цвет, фон, минимум]: фон «card» — стекло поверх страницы. */
const PAIRS: [string, string, number][] = [
  ["text", "bg", 4.5],
  ["muted", "bg", 4.5],
  ["text", "card", 4.5],
  ["muted", "card", 4.5],
  ["ink-text", "ink", 4.5],
  ["accent", "bg", 4.5],
  ["accent", "card", 4.5],
  ["accent-text", "accent", 4.5],
  ["meeting-text", "meeting", 4.5],
  ["danger", "card", 4.5],
  ["slot-busy-text", "slot-busy", 4.5],
  ["field-line", "card", 3],
  ["btn-line", "card", 3],
  ["ring", "bg", 3],
  ["warning", "card", 3],
  ["slot-busy", "card", 3],
];

function check(theme: Record<string, string>, pages: Rgba[]): string[] {
  const failures: string[] = [];
  for (const [fg, bg, min] of PAIRS) {
    for (const page of pages) {
      const base = over(parse(theme.bg), page);
      const back = bg === "bg" ? base : over(parse(theme[bg]), base);
      const value = ratio(over(parse(theme[fg]), back), back);
      if (value < min) failures.push(`--${fg} на --${bg}: ${value.toFixed(2)} < ${min}`);
    }
  }
  return failures;
}

describe("контраст темы (WCAG AA)", () => {
  it("светлая тема", () => {
    expect(check(LIGHT, [[255, 255, 255, 1]])).toEqual([]);
  });

  it("тёмная тема — и над тёмным небом, и над свечением горизонта", () => {
    // #0F163A под 38% #2656CE — самое светлое место неба (tokens.css, --sky).
    const horizon = over([38, 86, 206, 0.38], [15, 22, 58, 1]);
    expect(check(DARK, [parse(DARK.bg), horizon])).toEqual([]);
  });

  it("тёмная тема по системной настройке и выбранная вручную — одни и те же токены", () => {
    const manual = block(':root[data-theme="dark"] {');
    expect(DARK_SYSTEM).toEqual(manual);
  });
});
