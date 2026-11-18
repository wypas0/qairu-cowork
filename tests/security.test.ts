import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isOwnOrDirect, isSameOriginPost } from "@/lib/secFetch";
import { proxy } from "@/proxy";
import nextConfig from "../next.config";

// Вебхук без базы и без бота: обработку апдейта и запись метрик подменяем,
// секрет вебхука можно на один вызов сделать пустым.
vi.mock("@/bot/router", () => ({ handleUpdate: vi.fn(async () => {}) }));
vi.mock("@/lib/metrics", () => ({ observeRoute: vi.fn() }));
vi.mock("@/lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config")>();
  return { ...actual, webhookSecret: vi.fn(actual.webhookSecret) };
});

const headers = (values: Record<string, string>) => new Headers(values);

describe("вступление по ссылке: откуда запрос", () => {
  it("свой сайт и адрес, открытый человеком, — вступаем сразу", () => {
    expect(isOwnOrDirect(headers({ "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors" }))).toBe(true);
    expect(isOwnOrDirect(headers({ "sec-fetch-site": "none", "sec-fetch-mode": "navigate" }))).toBe(true);
  });

  it("чужая страница и браузер без Sec-Fetch — только по кнопке", () => {
    expect(isOwnOrDirect(headers({ "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate" }))).toBe(false);
    expect(isOwnOrDirect(headers({ "sec-fetch-site": "cross-site", "sec-fetch-mode": "no-cors" }))).toBe(false);
    expect(isOwnOrDirect(headers({ "sec-fetch-site": "same-site", "sec-fetch-mode": "navigate" }))).toBe(false);
    expect(isOwnOrDirect(headers({ "sec-fetch-site": "none", "sec-fetch-mode": "no-cors" }))).toBe(false);
    expect(isOwnOrDirect(headers({}))).toBe(false);
  });
});

describe("действия консоли владельца: только со своей страницы", () => {
  it("same-origin по Sec-Fetch-Site или совпавший Origin — да", () => {
    expect(isSameOriginPost(headers({ "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(isSameOriginPost(headers({ origin: "https://qairu.example", host: "qairu.example" }))).toBe(true);
  });

  it("чужой сайт, поддомен, пустые заголовки — нет", () => {
    expect(isSameOriginPost(headers({ "sec-fetch-site": "cross-site", origin: "https://qairu.example", host: "qairu.example" }))).toBe(false);
    expect(isSameOriginPost(headers({ "sec-fetch-site": "same-site" }))).toBe(false);
    expect(isSameOriginPost(headers({ origin: "https://evil.example", host: "qairu.example" }))).toBe(false);
    expect(isSameOriginPost(headers({ origin: "null", host: "qairu.example" }))).toBe(false);
    expect(isSameOriginPost(headers({ host: "qairu.example" }))).toBe(false);
  });
});

describe("старая ссылка с токеном", () => {
  it("?t= не входит в аккаунт, а только убирается из адреса", () => {
    const response = proxy(new NextRequest("https://qairu.example/g/abcd1234?t=stolen&x=1"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://qairu.example/g/abcd1234?x=1");
    expect(response.cookies.get("qairu_token")).toBeUndefined();
  });
});

describe("вебхук Telegram: секрет", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  const post = async (secret?: string) => {
    const { POST } = await import("@/app/api/telegram/webhook/route");
    const request = new NextRequest("https://qairu.example/api/telegram/webhook", {
      method: "POST",
      headers: secret === undefined ? {} : { "x-telegram-bot-api-secret-token": secret },
      body: JSON.stringify({ update_id: 1 }),
    });
    return POST(request);
  };

  it("без бота отвечает 200 и ничего не делает", async () => {
    vi.stubEnv("BOT_TOKEN", "");
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "");
    const { handleUpdate } = await import("@/bot/router");
    expect((await post()).status).toBe(200);
    expect(handleUpdate).not.toHaveBeenCalled();
  });

  it("верный секрет — апдейт обрабатывается; неверный, пустой, другой длины — 401", async () => {
    vi.stubEnv("BOT_TOKEN", "123456:test-token");
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "s3cret-for-tests");
    const { handleUpdate } = await import("@/bot/router");
    for (const wrong of [undefined, "", "s3cret-for-test", "s3cret-for-tests-and-more", "S3CRET-FOR-TESTS"]) {
      expect((await post(wrong)).status, String(wrong)).toBe(401);
    }
    expect(handleUpdate).not.toHaveBeenCalled();
    expect((await post("s3cret-for-tests")).status).toBe(200);
    expect(handleUpdate).toHaveBeenCalledTimes(1);
  });

  it("секрет без переменной выводится из токена бота — по нему и пускает", async () => {
    vi.stubEnv("BOT_TOKEN", "123456:test-token");
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "");
    const { webhookSecret } = await import("@/lib/config");
    const derived = webhookSecret();
    expect(derived).toHaveLength(48);
    expect((await post(derived)).status).toBe(200);
    expect((await post("")).status).toBe(401);
  });

  it("пустой секрет при включённом боте — отказ, а не «пускать всех»", async () => {
    vi.stubEnv("BOT_TOKEN", "123456:test-token");
    const config = await import("@/lib/config");
    vi.mocked(config.webhookSecret).mockReturnValue("");
    const { handleUpdate } = await import("@/bot/router");
    expect((await post("")).status).toBe(401);
    expect((await post()).status).toBe(401);
    expect(handleUpdate).not.toHaveBeenCalled();
    vi.mocked(config.webhookSecret).mockRestore();
  });
});

describe("заголовки безопасности", () => {
  it("на всех адресах: frame-ancestors, nosniff, Referrer-Policy", async () => {
    const rules = await nextConfig.headers!();
    const all = rules.find((rule) => rule.source === "/:path*")!;
    const byKey = Object.fromEntries(all.headers.map((header) => [header.key, header.value]));
    expect(byKey).toMatchObject({
      "Content-Security-Policy": "frame-ancestors 'self' https://*.telegram.org",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    });
  });
});

describe("robots.txt и карта сайта", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("robots закрывает группы, друзей, API и вход, но не называет консоль владельца", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://qairu.example/");
    const { default: robots } = await import("@/app/robots");
    const result = robots();
    const rules = Array.isArray(result.rules) ? result.rules[0] : result.rules;
    expect(rules.userAgent).toBe("*");
    expect(rules.allow).toBe("/");
    expect(rules.disallow).toEqual(["/g/", "/f/", "/friends", "/api/", "/login", "/account", "/connect"]);
    expect(JSON.stringify(result)).not.toContain("admin");
    expect(result.sitemap).toBe("https://qairu.example/sitemap.xml");
  });

  it("в карте сайта только лендинг и страница расширения", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://qairu.example");
    const { default: sitemap } = await import("@/app/sitemap");
    expect(sitemap().map((entry) => entry.url)).toEqual(["https://qairu.example/", "https://qairu.example/extension"]);
  });
});
