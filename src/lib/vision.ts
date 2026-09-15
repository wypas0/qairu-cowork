/**
 * Распознавание картинок через OpenAI-совместимый API.
 *
 * По умолчанию — OpenAI (gpt-4o-mini). Сервис меняется переменными окружения
 * без правки кода: Google Gemini, OpenRouter, Groq и другие принимают тот же
 * формат запроса /chat/completions с картинками.
 *
 *   VISION_API_KEY       ключ (или OPENAI_API_KEY)
 *   VISION_API_BASE_URL  по умолчанию https://api.openai.com/v1
 *   VISION_MODEL         по умолчанию gpt-4o-mini
 */

import "server-only";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";
const TIMEOUT_MS = 50_000;

export function visionApiKey(): string {
  return (process.env.VISION_API_KEY ?? process.env.OPENAI_API_KEY ?? "").trim();
}

export function hasVision(): boolean {
  return visionApiKey().length > 0;
}

export class VisionError extends Error {
  constructor(
    readonly kind: "not_configured" | "rate_limited" | "auth" | "upstream" | "timeout",
    message: string,
  ) {
    super(message);
  }
}

/**
 * Отправить подсказку и картинки, вернуть текст ответа модели.
 * `images` — data URL уже проверенных JPEG/PNG/WebP.
 */
export async function askVision(prompt: string, images: readonly string[]): Promise<string> {
  const key = visionApiKey();
  if (!key) throw new VisionError("not_configured", "VISION_API_KEY не задан");

  const baseUrl = (process.env.VISION_API_BASE_URL ?? DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  const model = (process.env.VISION_MODEL ?? DEFAULT_MODEL).trim();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      signal: controller.signal,
      cache: "no-store",
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: prompt },
          {
            role: "user",
            content: [
              { type: "text", text: "Extract the timetable from these screenshots." },
              ...images.map((url) => ({ type: "image_url", image_url: { url, detail: "high" } })),
            ],
          },
        ],
      }),
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw new VisionError("timeout", "таймаут");
    throw new VisionError("upstream", `сеть: ${(error as Error).message}`);
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 429) throw new VisionError("rate_limited", "лимит сервиса");
  if (response.status === 401 || response.status === 403) throw new VisionError("auth", "ключ не принят");
  if (!response.ok) {
    // Тело ответа в лог не пишем целиком: там может оказаться эхо запроса.
    throw new VisionError("upstream", `HTTP ${response.status}`);
  }

  const data = (await response.json()) as { choices?: { message?: { content?: unknown } }[] };
  const content = data.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : "";
}
