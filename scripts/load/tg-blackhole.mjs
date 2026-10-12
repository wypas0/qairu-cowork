// Заглушка Telegram Bot API для нагрузочного теста бота.
//
// Подгружается в процесс `next start` через NODE_OPTIONS=--import (это делает
// `node scripts/dev/e2e-server.mjs <порт> --fake-bot`). Подменяет глобальный
// fetch: всё, что идёт на *.telegram.org, не уходит в сеть, а сразу получает
// правдоподобный ответ `{ok: true, result: …}`. Остальные запросы — как были.
// Так бот проходит весь путь апдейта (база, тексты, клавиатуры), а живой
// Telegram не видит ни одного вызова.
//
// LOAD_TG_DELAY_MS — искусственная задержка ответа «Telegram», мс (по умолчанию 0):
// настоящий отвечает за 50–300 мс, и всё это время функция на Vercel занята.

import { env } from "../env.mjs";

const TELEGRAM_HOST = /(^|\.)telegram\.org$/i;
const delayMs = Math.max(0, Number(env("LOAD_TG_DELAY_MS") ?? 0) || 0);
const realFetch = globalThis.fetch;
let messageId = 1;
let calls = 0;

/** @param {unknown} body */
function payloadOf(body) {
  if (typeof body !== "string") return {};
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

/**
 * @param {string} method
 * @param {Record<string, unknown>} payload
 */
function fakeResult(method, payload) {
  const chatId = Number(payload.chat_id ?? 0);
  const chat = { id: chatId, type: chatId < 0 ? "group" : "private" };
  switch (method) {
    case "getMe":
      return { id: 7_999_999_999, is_bot: true, first_name: "Qairu Load", username: "qairu_load_bot", has_main_web_app: false };
    case "sendMessage":
    case "editMessageText":
    case "editMessageReplyMarkup":
      return { message_id: messageId++, chat, date: Math.floor(Date.now() / 1000), text: String(payload.text ?? "") };
    case "getChatMember":
      return { status: "administrator", user: { id: Number(payload.user_id ?? 0), is_bot: false, first_name: "x" } };
    case "getChatAdministrators":
      return [];
    case "getWebhookInfo":
      return { url: "", pending_update_count: 0 };
    default:
      return true;
  }
}

/**
 * @param {Parameters<typeof fetch>[0]} input
 * @param {Parameters<typeof fetch>[1]} [init]
 */
async function fetchWithBlackhole(input, init) {
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  let url;
  try {
    url = new URL(href);
  } catch {
    return realFetch(input, init);
  }
  if (!TELEGRAM_HOST.test(url.hostname)) return realFetch(input, init);

  calls++;
  if (calls === 1) console.error("[load] вызов Telegram перехвачен заглушкой — в сеть не ушёл");
  const method = url.pathname.split("/").pop() ?? "";
  let body = init?.body;
  if (body === undefined && input instanceof Request) body = await input.clone().text();
  if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
  return Response.json({ ok: true, result: fakeResult(method, payloadOf(body)) });
}

globalThis.fetch = fetchWithBlackhole;
console.error(`[load] Telegram Bot API подменён заглушкой (задержка ${delayMs} мс)`);
