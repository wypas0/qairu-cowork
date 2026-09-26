import { describe, expect, it } from "vitest";

import { brandMarkInner, brandMarkSvg } from "@/lib/brand";

describe("знак продукта", () => {
  it("рисуется только переданным цветом", () => {
    // Белый знак на кобальте: чужой цвет в рисунке пропал бы на фоне иконки.
    const colors = [...brandMarkSvg("white").matchAll(/(?:stroke|fill)="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(colors)).toEqual(new Set(["none", "white"]));
  });

  it("в шапке и в иконках — один и тот же рисунок 24×24", () => {
    const svg = brandMarkSvg("currentColor");
    expect(svg).toMatch(/^<svg [^>]*viewBox="0 0 24 24"/);
    expect(svg).toContain(brandMarkInner("currentColor"));
  });
});

describe("цвета темы для Telegram", () => {
  it("короткая запись и rgb() доходят до шапки мини-аппа как #rrggbb", async () => {
    const { hexColor } = await import("@/lib/telegram");
    // Сборка сжимает #ffffff до #fff — светлая тема раньше не красила шапку.
    expect(hexColor("#fff")).toBe("#ffffff");
    expect(hexColor(" #F4F6FA ")).toBe("#f4f6fa");
    expect(hexColor("rgb(3, 4, 12)")).toBe("#03040c");
    expect(hexColor("rgb(3 4 12 / 1)")).toBe("#03040c");
    // Полупрозрачный цвет Telegram не примет — лучше не красить вовсе.
    expect(hexColor("rgba(255, 255, 255, 0.08)")).toBeNull();
    expect(hexColor("var(--x)")).toBeNull();
  });
});
