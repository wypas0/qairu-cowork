import type { NextRequest } from "next/server";

import type { TgUpdate } from "@/bot/api";
import { handleUpdate } from "@/bot/router";
import { hasBot, webhookSecret } from "@/lib/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Приёмник апдейтов Telegram.
 *
 * Отвечаем 200 всегда, даже если обработка упала: на любой другой ответ
 * Telegram повторяет апдейт с нарастающей задержкой, и одна ошибка в разборе
 * превращается в бесконечный поток одинаковых запросов.
 */
export async function POST(request: NextRequest) {
  if (!hasBot()) return new Response("bot disabled", { status: 200 });

  const secret = webhookSecret();
  if (request.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return new Response("forbidden", { status: 401 });
  }

  let update: TgUpdate;
  try {
    update = (await request.json()) as TgUpdate;
  } catch {
    return new Response("ok", { status: 200 });
  }

  try {
    await handleUpdate(update);
  } catch (error) {
    console.error("qairu: ошибка при обработке апдейта", update.update_id, error);
  }
  return new Response("ok", { status: 200 });
}
