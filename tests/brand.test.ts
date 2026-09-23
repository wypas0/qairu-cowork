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
