/**
 * Переменные окружения. Vercel хранит пустые значения как есть, и пустая
 * строка должна значить «не задана» — иначе `??` пропускает её мимо запасного
 * значения (так консоль упала на DEFAULT_TZ="").
 */

import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { alertChatId, botToken, cronSecret, defaultTz, env, hasBot, ownerConsoleSecret, siteUrl, webhookSecret } from "@/lib/config";
import { ownerIds } from "@/lib/owner";
import { hasVision, visionApiKey, visionEndpoint } from "@/lib/vision";
import { env as scriptEnv } from "../scripts/env.mjs";

afterEach(() => vi.unstubAllEnvs());

/** Все ключи из .env.example плюс те, что подставляет Vercel или задают руками. */
const KEYS = [
  ...readFileSync(new URL("../.env.example", import.meta.url), "utf8")
    .split("\n")
    .map((line) => /^([A-Z][A-Z0-9_]*)=/.exec(line.trim())?.[1])
    .filter((key): key is string => Boolean(key)),
  "WEB_BASE_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "VERCEL_URL",
  "VERCEL_ENV",
  "VERCEL_GIT_COMMIT_SHA",
  "VERCEL_GIT_COMMIT_REF",
  "DATABASE_POOL_MAX",
  "DESIGN_SPECIMEN",
];

describe("env()", () => {
  it("пустая строка и пробелы — не задана; значение — без пробелов по краям", () => {
    vi.stubEnv("QAIRU_PROBE", undefined);
    expect(env("QAIRU_PROBE")).toBeUndefined();
    vi.stubEnv("QAIRU_PROBE", "");
    expect(env("QAIRU_PROBE")).toBeUndefined();
    vi.stubEnv("QAIRU_PROBE", " \t ");
    expect(env("QAIRU_PROBE")).toBeUndefined();
    vi.stubEnv("QAIRU_PROBE", "  value ");
    expect(env("QAIRU_PROBE")).toBe("value");
  });

  it("у скриптов сборки то же правило", () => {
    vi.stubEnv("QAIRU_PROBE", "  ");
    expect(scriptEnv("QAIRU_PROBE")).toBeUndefined();
    vi.stubEnv("QAIRU_PROBE", " x ");
    expect(scriptEnv("QAIRU_PROBE")).toBe("x");
  });
});

describe("все переменные пустые (как бывает в Vercel)", () => {
  for (const blank of ["", "   "]) {
    it(`${JSON.stringify(blank)}: ничего не падает, везде значения по умолчанию`, () => {
      expect(KEYS).toEqual(expect.arrayContaining(["DATABASE_URL", "BOT_TOKEN", "VISION_API_KEY", "DEFAULT_TZ", "CRON_SECRET"]));
      for (const key of KEYS) vi.stubEnv(key, blank);

      expect(botToken()).toBe("");
      expect(hasBot()).toBe(false);
      expect(webhookSecret()).toBe("");
      expect(siteUrl()).toBe("");
      expect(defaultTz()).toBe("Asia/Almaty");
      expect(() => new Intl.DateTimeFormat("ru", { timeZone: defaultTz() })).not.toThrow();
      expect(cronSecret()).toBe("");
      expect(alertChatId()).toBe("");
      expect(ownerConsoleSecret()).toBe("");
      expect(ownerIds().size).toBe(0);
      expect(visionApiKey()).toBe("");
      expect(hasVision()).toBe(false);
      expect(visionEndpoint()).toEqual({ baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" });
      for (const key of KEYS) expect(scriptEnv(key)).toBeUndefined();
    });
  }

  it("пустая переменная не перекрывает следующую по цепочке", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.stubEnv("WEB_BASE_URL", "https://cowork.example/");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "qairu-cowork.vercel.app");
    expect(siteUrl()).toBe("https://cowork.example");

    vi.stubEnv("WEB_BASE_URL", " ");
    expect(siteUrl()).toBe("https://qairu-cowork.vercel.app");

    // Пустой VISION_API_KEY больше не прячет кнопку при заданном OPENAI_API_KEY.
    vi.stubEnv("VISION_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    expect(visionApiKey()).toBe("sk-test");
    expect(hasVision()).toBe(true);

    vi.stubEnv("VISION_API_BASE_URL", "https://openrouter.example/api/v1/");
    vi.stubEnv("VISION_MODEL", " some/model ");
    expect(visionEndpoint()).toEqual({ baseUrl: "https://openrouter.example/api/v1", model: "some/model" });
  });
});

describe("defaultTz — пояс консоли владельца", () => {
  it("без переменной — Asia/Almaty", () => {
    vi.stubEnv("DEFAULT_TZ", undefined);
    expect(defaultTz()).toBe("Asia/Almaty");
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
