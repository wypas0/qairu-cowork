import { afterEach, describe, expect, it, vi } from "vitest";

import { defaultLang, defaultTz } from "@/lib/config";

afterEach(() => vi.unstubAllEnvs());

describe("defaultTz", () => {
  it("без переменной — Asia/Almaty", () => {
    vi.stubEnv("DEFAULT_TZ", undefined);
    expect(defaultTz()).toBe("Asia/Almaty");
  });

  it("пустая переменная (так бывает в Vercel) — Asia/Almaty, а не пустой пояс", () => {
    vi.stubEnv("DEFAULT_TZ", "  ");
    expect(defaultTz()).toBe("Asia/Almaty");
    expect(() => new Intl.DateTimeFormat("ru", { timeZone: defaultTz() })).not.toThrow();
  });

  it("опечатка в имени пояса — Asia/Almaty", () => {
    vi.stubEnv("DEFAULT_TZ", "Asia/Almatyy");
    expect(defaultTz()).toBe("Asia/Almaty");
  });

  it("настоящий пояс берётся как есть", () => {
    vi.stubEnv("DEFAULT_TZ", " Asia/Aqtobe ");
    expect(defaultTz()).toBe("Asia/Aqtobe");
  });
});

describe("defaultLang", () => {
  it("пустая переменная — ru", () => {
    vi.stubEnv("DEFAULT_LANG", "");
    expect(defaultLang()).toBe("ru");
  });

  it("заданный язык берётся как есть", () => {
    vi.stubEnv("DEFAULT_LANG", "kk");
    expect(defaultLang()).toBe("kk");
  });
});
