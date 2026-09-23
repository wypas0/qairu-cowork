import type { NextRequest } from "next/server";

import { GROUP_COMMANDS, PRIVATE_COMMANDS } from "@/bot/router";
import { setChatMenuButton, setMyCommands } from "@/bot/api";
import { forgetBotInfo } from "@/bot/context";
import { botToken, hasBot, webhookSecret } from "@/lib/config";
import { baseUrl } from "@/lib/url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Ручная регистрация вебхука и меню команд.
 *
 * На продакшене то же самое делает `scripts/set-webhook.mjs` после сборки.
 * Этот эндпоинт нужен для локальной разработки через туннель и когда адрес
 * сайта поменялся, а пересобирать проект незачем.
 *
 * Открыть: `/api/telegram/setup?secret=<TELEGRAM_WEBHOOK_SECRET>`.
 */
export async function GET(request: NextRequest) {
  if (!hasBot()) {
    return Response.json({ ok: false, detail: "BOT_TOKEN не задан" }, { status: 400 });
  }

  const secret = webhookSecret();
  if (request.nextUrl.searchParams.get("secret") !== secret) {
    return Response.json({ ok: false, detail: "forbidden" }, { status: 401 });
  }

  // Включили главное мини-приложение в BotFather — сайт узнает об этом сразу.
  await forgetBotInfo();

  const base = request.nextUrl.searchParams.get("url")?.replace(/\/+$/, "") || (await baseUrl());
  const url = `${base}/api/telegram/webhook`;

  const response = await fetch(`https://api.telegram.org/bot${botToken()}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      secret_token: secret,
      allowed_updates: ["message", "callback_query", "my_chat_member"],
      drop_pending_updates: true,
    }),
    cache: "no-store",
  });
  const body = (await response.json()) as { ok: boolean; description?: string };

  if (body.ok) {
    await setMyCommands({
      commands: PRIVATE_COMMANDS,
      scope: { type: "all_private_chats" },
    });
    await setMyCommands({ commands: GROUP_COMMANDS, scope: { type: "all_group_chats" } });
    // Кнопка «Открыть» рядом с полем ввода: сайт запускается как Mini App и входит сам.
    if (base.startsWith("https://")) {
      await setChatMenuButton({ menu_button: { type: "web_app", text: "Открыть", web_app: { url: base } } });
    }
  }

  return Response.json({ ok: body.ok, url, detail: body.description ?? null });
}
