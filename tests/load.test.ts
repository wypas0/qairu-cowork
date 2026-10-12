/**
 * Нагрузочный тест (scripts/load): разбор аргументов, правила безопасности
 * адреса, перцентили и сводка. Сеть здесь не нужна — только чистые части.
 */

import { describe, expect, it } from "vitest";

import {
  PROD_LIMITS,
  applySafety,
  classifyTarget,
  findKnee,
  formatStatuses,
  parseArgs,
  parseDuration,
  percentile,
  pickWeighted,
  summarize,
  verdict,
} from "../scripts/load/lib.mjs";
import { FAKE_USER_BASE, fakeUpdate, randomWeek, weightsFor } from "../scripts/load/scenarios.mjs";

const PROD = ["https://qairu-cowork.vercel.app", "https://qairu.example.kz"];

describe("parseArgs", () => {
  it("по умолчанию — board на e2e-сервер, одна ступень 10 на 20 с", () => {
    const options = parseArgs([]);
    expect(options).toMatchObject({
      target: "http://localhost:3230",
      scenario: "board",
      steps: [10],
      durationS: 20,
      requests: null,
      prodOk: false,
      realBotOk: false,
      warmup: true,
    });
  });

  it("ступени, длительность и флаги, в том числе через =", () => {
    const options = parseArgs([
      "--scenario=mixed",
      "--ramp",
      "5, 10,20",
      "--duration",
      "1m",
      "--i-know-this-is-prod",
      "--target",
      "https://x.vercel.app",
    ]);
    expect(options.scenario).toBe("mixed");
    expect(options.steps).toEqual([5, 10, 20]);
    expect(options.durationS).toBe(60);
    expect(options.prodOk).toBe(true);
    expect(options.target).toBe("https://x.vercel.app");
  });

  it("--requests вместо длительности", () => {
    const options = parseArgs(["--requests", "500", "--concurrency", "4"]);
    expect(options.requests).toBe(500);
    expect(options.durationS).toBeNull();
    expect(options.steps).toEqual([4]);
  });

  it("ошибки ввода — внятным сообщением, а не молча", () => {
    expect(() => parseArgs(["--scenario", "ddos"])).toThrow(/board, save, bot, mixed/);
    expect(() => parseArgs(["--ramp", "5,0"])).toThrow(/--ramp/);
    expect(() => parseArgs(["--concurrency", "2.5"])).toThrow(/--concurrency/);
    expect(() => parseArgs(["--requests", "10", "--duration", "5s"])).toThrow(/вместе/);
    expect(() => parseArgs(["--ramp", "5", "--concurrency", "5"])).toThrow(/вместе/);
    expect(() => parseArgs(["--target"])).toThrow(/нет значения/);
    expect(() => parseArgs(["--target", "--scenario", "bot"])).toThrow(/нет значения/);
    expect(() => parseArgs(["--force"])).toThrow(/неизвестный/);
    expect(() => parseArgs(["localhost"])).toThrow(/лишний/);
    expect(() => parseArgs(["--allow-real-bot=yes"])).toThrow(/флаг/);
  });

  it("длительность в разных единицах", () => {
    expect(parseDuration("30")).toBe(30);
    expect(parseDuration("30s")).toBe(30);
    expect(parseDuration("2m")).toBe(120);
    expect(parseDuration("1500ms")).toBe(1.5);
    expect(() => parseDuration("0s")).toThrow();
    expect(() => parseDuration("10h")).toThrow();
  });
});

describe("classifyTarget", () => {
  it("свой компьютер, превью и боевой", () => {
    expect(classifyTarget("http://localhost:3230", PROD).kind).toBe("local");
    expect(classifyTarget("http://127.0.0.1:3000/x", PROD)).toMatchObject({ kind: "local", origin: "http://127.0.0.1:3000" });
    expect(classifyTarget("http://[::1]:3230", PROD).kind).toBe("local");
    expect(classifyTarget("https://qairu-cowork-git-load-amir.vercel.app", PROD).kind).toBe("preview");
    expect(classifyTarget("https://qairu-cowork.vercel.app/g/abc", PROD).kind).toBe("prod");
    expect(classifyTarget("https://QAIRU.example.kz", PROD).kind).toBe("prod");
  });

  it("любой чужой домен — как боевой: свой домен тоже может быть боевым", () => {
    expect(classifyTarget("https://example.com", PROD)).toMatchObject({ kind: "prod" });
    // Похожее имя — не localhost.
    expect(classifyTarget("http://localhost.evil.com", PROD).kind).toBe("prod");
  });

  it("Telegram и не-http — никогда", () => {
    expect(() => classifyTarget("https://api.telegram.org/bot1/getMe", PROD)).toThrow(/Telegram/);
    expect(() => classifyTarget("https://t.me/qairu_bot", PROD)).toThrow(/Telegram/);
    expect(() => classifyTarget("ftp://localhost", PROD)).toThrow(/http/);
    expect(() => classifyTarget("localhost:3230", PROD)).toThrow();
    expect(() => classifyTarget("https://user:pass@x.vercel.app", PROD)).toThrow(/логина/);
  });
});

describe("applySafety", () => {
  const local = classifyTarget("http://localhost:3230", PROD);
  const preview = classifyTarget("https://qc-load.vercel.app", PROD);
  const prod = classifyTarget("https://qairu-cowork.vercel.app", PROD);

  it("локально и на превью — как задано", () => {
    const options = parseArgs(["--ramp", "5,50,200"]);
    expect(applySafety(options, local).steps).toEqual([5, 50, 200]);
    expect(applySafety(options, preview)).toMatchObject({ steps: [5, 50, 200], warnings: [] });
  });

  it("боевой без флага — отказ", () => {
    expect(() => applySafety(parseArgs([]), prod)).toThrow(/--i-know-this-is-prod/);
  });

  it("боевой с флагом — урезано и с предупреждением", () => {
    const options = parseArgs(["--ramp", "2,5,10,50", "--duration", "5m", "--i-know-this-is-prod"]);
    const plan = applySafety(options, prod);
    expect(plan.steps).toEqual([2, PROD_LIMITS.concurrency]);
    expect(plan.durationS).toBe(PROD_LIMITS.durationS);
    expect(plan.warnings.join("\n")).toMatch(/Vercel Hobby/);
    const byCount = applySafety(parseArgs(["--requests", "5000", "--i-know-this-is-prod"]), prod);
    expect(byCount.requests).toBe(PROD_LIMITS.requests);
  });

  it("bot — только против e2e-сервера с заглушкой, иначе нужен явный флаг", () => {
    const bot = parseArgs(["--scenario", "bot"]);
    expect(applySafety(bot, local, { fakeBotProven: true }).warnings).toEqual([]);
    expect(() => applySafety(bot, local)).toThrow(/--allow-real-bot/);
    expect(() => applySafety(bot, preview)).toThrow(/--allow-real-bot/);
    const allowed = applySafety(parseArgs(["--scenario", "bot", "--allow-real-bot"]), preview);
    expect(allowed.warnings.join("\n")).toMatch(/api\.telegram\.org/);
    // Флаг бота не отменяет правила боевого сайта.
    expect(() => applySafety(parseArgs(["--scenario", "bot", "--allow-real-bot"]), prod)).toThrow(/prod/);
  });

  it("mixed без секрета вебхука идёт без бота и флага не требует", () => {
    const mixed = parseArgs(["--scenario", "mixed"]);
    expect(() => applySafety(mixed, preview)).toThrow(/--allow-real-bot/);
    expect(applySafety(mixed, preview, { usesBot: false }).warnings).toEqual([]);
  });
});

describe("percentile и summarize", () => {
  it("ближайший ранг", () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(sorted, 50)).toBe(50);
    expect(percentile(sorted, 95)).toBe(95);
    expect(percentile(sorted, 99)).toBe(99);
    expect(percentile(sorted, 100)).toBe(100);
    expect(percentile(sorted, 0)).toBe(1);
    expect(percentile([7], 99)).toBe(7);
    expect(percentile([], 50)).toBeNaN();
  });

  it("сводка: rps, задержки, ошибки по кодам", () => {
    const samples = [
      ...Array.from({ length: 96 }, (_, i) => ({ kind: "a", ok: true, status: 200, ms: i + 1, bytes: 10 })),
      { kind: "a", ok: false, status: 500, ms: 900 },
      { kind: "a", ok: false, status: 500, ms: 950 },
      { kind: "a", ok: false, status: "timeout", ms: 15_000 },
      { kind: "a", ok: false, status: 307, ms: 960 },
    ];
    const summary = summarize(samples, 10);
    expect(summary.count).toBe(100);
    expect(summary.rps).toBe(10);
    expect(summary.p50).toBe(50);
    expect(summary.p95).toBe(95);
    expect(summary.p99).toBe(960);
    expect(summary.max).toBe(15_000);
    expect(summary.errorRate).toBeCloseTo(0.04);
    expect(summary.errors).toEqual({ "500": 2, timeout: 1, "307": 1 });
    expect(summary.statuses["200"]).toBe(96);
    expect(formatStatuses(summary.statuses)).toBe("200×96 500×2 307×1 timeout×1");
  });

  it("пустая ступень не падает", () => {
    expect(summarize([], 0)).toMatchObject({ count: 0, rps: 0, p50: null, errorRate: 0 });
    expect(verdict(summarize([], 0))).toBe("НЕТ ДАННЫХ");
  });

  it("вердикт по p95 и доле ошибок", () => {
    const at = (p95: number, errorRate = 0) => verdict({ ...summarize([], 1), count: 1, p95, errorRate });
    expect(at(300)).toBe("ДЕРЖИТ");
    expect(at(1200)).toBe("ТЕРПИМО");
    expect(at(2500)).toBe("МЕДЛЕННО");
    expect(at(100, 0.05)).toMatch(/ОШИБКИ 5\.0%/);
  });
});

describe("findKnee", () => {
  const step = (concurrency: number, rps: number, p95: number, errorRate = 0) => ({
    concurrency,
    summary: { ...summarize([], 1), count: 1, rps, p95, errorRate },
  });

  it("rps перестал расти — загиб", () => {
    const knee = findKnee([step(5, 50, 100), step(10, 95, 120), step(20, 100, 230)]);
    expect(knee).toMatchObject({ concurrency: 20 });
    expect(knee?.reason).toMatch(/rps/);
  });

  it("rps растёт, но много медленнее параллельности — загиб", () => {
    // ×2,5 людей и +16% rps.
    expect(findKnee([step(5, 30, 600), step(20, 55, 690), step(50, 64, 1290)])).toMatchObject({ concurrency: 50 });
  });

  it("провал, который следующие ступени отыгрывают, — шум, не загиб", () => {
    // Прогон на этой машине: на 10 соседний процесс отъел CPU, на 20 всё вернулось.
    const knee = findKnee([step(5, 26, 674), step(10, 23, 1122), step(20, 54.9, 688), step(50, 63.8, 1289)]);
    expect(knee).toMatchObject({ concurrency: 50 });
  });

  it("p95 вырос больше чем вдвое и не вернулся — загиб", () => {
    expect(findKnee([step(5, 50, 100), step(10, 90, 250)])?.reason).toMatch(/p95/);
    expect(findKnee([step(5, 50, 100), step(10, 90, 250), step(20, 170, 120)])).toBeNull();
  });

  it("ошибки — загиб сразу", () => {
    expect(findKnee([step(5, 50, 100, 0.2)])).toMatchObject({ concurrency: 5 });
  });

  it("растёт ровно — загиба нет", () => {
    expect(findKnee([step(5, 50, 100), step(10, 98, 110), step(20, 190, 130)])).toBeNull();
  });
});

describe("сценарии", () => {
  it("взвешенный выбор", () => {
    const items = [
      { name: "a", weight: 1 },
      { name: "b", weight: 3 },
    ];
    expect(pickWeighted(items, 0).name).toBe("a");
    expect(pickWeighted(items, 0.24).name).toBe("a");
    expect(pickWeighted(items, 0.25).name).toBe("b");
    expect(pickWeighted(items, 0.999).name).toBe("b");
  });

  it("mixed без бота — без апдейтов в вебхук", () => {
    expect(weightsFor("mixed", { botEnabled: false }).map((item) => item.kind)).not.toContain("bot");
    expect(weightsFor("mixed", { botEnabled: true }).map((item) => item.kind)).toContain("bot");
  });

  it("неделя пар проходит проверку сервера (cleanIncomingSlots)", () => {
    for (const slot of randomWeek(Math.random)) {
      expect(slot.weekday).toBeGreaterThanOrEqual(0);
      expect(slot.weekday).toBeLessThanOrEqual(6);
      expect(slot.start).toBeLessThan(slot.end);
      expect(slot.end).toBeLessThanOrEqual(24 * 60);
    }
  });

  it("апдейты — только от выдуманных людей и в выдуманные чаты", () => {
    for (let i = 0; i < 200; i++) {
      const update = fakeUpdate(Math.random);
      const message = update.message ?? update.callback_query?.message;
      const from = update.message?.from ?? update.callback_query?.from;
      if (!message || !from) throw new Error("апдейт без сообщения или автора");
      expect(from.id).toBeGreaterThanOrEqual(FAKE_USER_BASE);
      expect(Number.isSafeInteger(from.id)).toBe(true);
      expect(Number.isSafeInteger(message.chat.id)).toBe(true);
      // Не формат супергрупп Telegram (-100…): с настоящим токеном такого чата нет.
      if (message.chat.id < 0) expect(String(message.chat.id).startsWith("-100")).toBe(false);
      else expect(message.chat.id).toBe(from.id);
    }
  });
});
