/**
 * Расписание со скриншота: разбор ответа нейросети и запрос к OpenAI-совместимому API.
 * В сеть тесты не ходят — fetch подменяется.
 */

import { afterEach, describe, expect, it } from "vitest";

import { mergeSlots, parseVisionSlots, type PhotoSlot } from "@/core/photoSchedule";

/** Ответ модели по скриншоту портала QAIRU (фрагмент реальной недели). */
const PORTAL_ANSWER = JSON.stringify({
  slots: [
    { weekday: 0, start: "08:00", end: "08:50", title: "Introduction to Programming", kind: "lecture", parity: null },
    { weekday: 0, start: "09:00", end: "09:50", title: "Introduction to Programming", kind: "lecture", parity: null },
    { weekday: 1, start: "08:00", end: "08:50", title: "AI Fundamentals", kind: "lecture", parity: null },
    { weekday: 1, start: "09:00", end: "09:50", title: "AI Fundamentals", kind: "lecture", parity: null },
    { weekday: 1, start: "10:00", end: "10:50", title: "Introduction to Programming", kind: "practice", parity: null },
    { weekday: 1, start: "11:10", end: "12:00", title: "Introduction to Programming", kind: "practice", parity: null },
    { weekday: 1, start: "12:10", end: "13:00", title: "Introduction to Programming", kind: "practice", parity: null },
    { weekday: 5, start: "08:00", end: "08:50", title: "History of Kazakhstan", kind: "lecture", parity: null },
  ],
});

describe("разбор ответа нейросети", () => {
  it("соседние пары одного предмета склеиваются, перерыв 20 минут — нет", () => {
    const slots = parseVisionSlots(PORTAL_ANSWER);
    expect(slots.map((slot) => [slot.weekday, slot.text, slot.label])).toEqual([
      [0, "08:00–09:50", "Introduction to Programming"],
      [1, "08:00–09:50", "AI Fundamentals"],
      // 10:00–10:50, затем «Break 20 min», затем 11:10–12:00 и 12:10–13:00.
      [1, "10:00–10:50", "Introduction to Programming"],
      [1, "11:10–13:00", "Introduction to Programming"],
      [5, "08:00–08:50", "History of Kazakhstan"],
    ]);
    expect(slots[0]).toMatchObject({ start: 480, end: 590, kind: "lecture", parity: null });
  });

  it("мусорные элементы отбрасываются, остальные остаются", () => {
    const slots = parseVisionSlots(
      JSON.stringify({
        slots: [
          { weekday: 7, start: "08:00", end: "09:00", title: "нет такого дня" },
          { weekday: 2, start: "10:00", end: "09:00", title: "конец раньше начала" },
          { weekday: 2, start: "25:00", end: "26:00", title: "нет такого времени" },
          { weekday: "понедельник", start: "08:00", end: "09:00", title: "день словом" },
          "вообще не объект",
          { weekday: 3, start: "8.00", end: "9:30", title: "  Матан\n\tлекция  ", kind: "LECTURE", parity: 1 },
        ],
      }),
    );
    expect(slots).toEqual([
      { weekday: 3, start: 480, end: 570, label: "Матан лекция", kind: "lecture", parity: 1, text: "08:00–09:30" },
    ]);
  });

  it("ответ в ```json``` или с текстом вокруг тоже разбирается, бессмыслица даёт пустой список", () => {
    const fenced = "```json\n" + PORTAL_ANSWER + "\n```";
    expect(parseVisionSlots(fenced)).toHaveLength(5);
    expect(parseVisionSlots(`Вот расписание: ${PORTAL_ANSWER} Удачи!`)).toHaveLength(5);
    expect(parseVisionSlots("я не вижу расписания")).toEqual([]);
    expect(parseVisionSlots('{"slots": "нет"}')).toEqual([]);
  });

  it("одна и та же пара с двух скриншотов не дублируется, пары разной чётности не склеиваются", () => {
    const base: PhotoSlot = { weekday: 4, start: 600, end: 650, label: "Физика", kind: "lab", parity: 0, text: "" };
    const merged = mergeSlots([base, { ...base }, { ...base, start: 660, end: 710, parity: 1 }]);
    expect(merged.map((slot) => [slot.text, slot.parity])).toEqual([
      ["10:00–10:50", 0],
      ["11:00–11:50", 1],
    ]);
  });
});

describe("запрос к API распознавания", () => {
  const realFetch = globalThis.fetch;
  const saved = { ...process.env };

  afterEach(() => {
    globalThis.fetch = realFetch;
    process.env = { ...saved };
  });

  function stubFetch(status: number, body: unknown) {
    const calls: { url: string; init: RequestInit }[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {} });
      return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    return calls;
  }

  it("по умолчанию — OpenAI gpt-4o-mini, картинки уходят в сообщении, ключ в заголовке", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    delete process.env.VISION_API_KEY;
    delete process.env.VISION_API_BASE_URL;
    delete process.env.VISION_MODEL;
    const calls = stubFetch(200, { choices: [{ message: { content: PORTAL_ANSWER } }] });
    const { askVision } = await import("@/lib/vision");

    const content = await askVision("prompt", ["data:image/jpeg;base64,AAAA"]);
    expect(content).toBe(PORTAL_ANSWER);
    expect(calls[0].url).toBe("https://api.openai.com/v1/chat/completions");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[1].content[1]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/jpeg;base64,AAAA", detail: "high" },
    });
  });

  it("сервис меняется переменными окружения без правки кода", async () => {
    process.env.VISION_API_KEY = "other-key";
    process.env.VISION_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";
    process.env.VISION_MODEL = "gemini-2.0-flash";
    const calls = stubFetch(200, { choices: [{ message: { content: "{}" } }] });
    const { askVision } = await import("@/lib/vision");

    await askVision("prompt", ["data:image/png;base64,AAAA"]);
    expect(calls[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    expect(JSON.parse(String(calls[0].init.body)).model).toBe("gemini-2.0-flash");
  });

  it("ошибки сервиса превращаются в понятные виды: лимит, неверный ключ, сбой", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const { askVision, VisionError } = await import("@/lib/vision");

    stubFetch(429, { error: { message: "Rate limit" } });
    await expect(askVision("p", [])).rejects.toMatchObject({ kind: "rate_limited" });
    stubFetch(401, { error: { message: "Incorrect API key" } });
    await expect(askVision("p", [])).rejects.toMatchObject({ kind: "auth" });
    stubFetch(500, {});
    await expect(askVision("p", [])).rejects.toBeInstanceOf(VisionError);
  });

  it("без ключа распознавание выключено", async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.VISION_API_KEY;
    const { askVision, hasVision } = await import("@/lib/vision");
    expect(hasVision()).toBe(false);
    await expect(askVision("p", [])).rejects.toMatchObject({ kind: "not_configured" });
  });
});

describe("ограничения на скриншоты", () => {
  it("не больше 2 скриншотов, каждый меньше мегабайта — проверяется по содержимому", async () => {
    const { MAX_PHOTOS, PHOTO_MAX_BYTES } = await import("@/core/photoSchedule");
    const { parseAvatarDataUrl } = await import("@/core/avatar");
    expect(MAX_PHOTOS).toBe(2);
    expect(PHOTO_MAX_BYTES).toBeLessThan(1024 * 1024);

    const jpeg = (size: number) =>
      `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(size - 4)]).toString("base64")}`;
    expect(parseAvatarDataUrl(jpeg(900 * 1024), PHOTO_MAX_BYTES)).toMatchObject({ ok: true });
    expect(parseAvatarDataUrl(jpeg(1024 * 1024), PHOTO_MAX_BYTES)).toEqual({ ok: false, error: "too_large" });
  });
});
