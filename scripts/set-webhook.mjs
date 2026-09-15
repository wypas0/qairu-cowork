/**
 * Регистрация вебхука Telegram после сборки.
 *
 * Запускается из `npm run build`, поэтому не имеет права уронить деплой:
 * любая ошибка здесь превращается в предупреждение. Сам сайт работает и без
 * бота — токен нужен только тем, кто им пользуется.
 *
 * Достаточно положить BOT_TOKEN в переменные окружения проекта: адрес Vercel
 * подставит сам, секрет заголовка выводится из токена.
 */

import { createHash } from "node:crypto";

const FORCED = process.argv.includes("--force");

function log(message) {
  console.log(`[qairu:webhook] ${message}`);
}

function siteUrl() {
  const explicit = (process.env.NEXT_PUBLIC_SITE_URL ?? process.env.WEB_BASE_URL ?? "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (production) return `https://${production}`;
  const preview = process.env.VERCEL_URL;
  if (preview) return `https://${preview}`;
  return "";
}

function webhookSecret(token) {
  const explicit = (process.env.TELEGRAM_WEBHOOK_SECRET ?? "").trim();
  if (explicit) return explicit;
  return createHash("sha256").update(`qairu-webhook:${token}`).digest("hex").slice(0, 48);
}

// Держать в согласии с src/bot/router.ts: у бота мало команд, основное — на сайте.
const PRIVATE_COMMANDS = [
  { command: "start", description: "Открыть QairuCowork" },
  { command: "lang", description: "Язык / Тіл / Language" },
  { command: "help", description: "Что умеет бот" },
];

const GROUP_COMMANDS = [
  { command: "setup", description: "Подключить чат (админ)" },
  { command: "join", description: "Добавить себя в участники" },
  { command: "members", description: "Кто заполнил расписание" },
  { command: "free", description: "Общие свободные окна" },
  { command: "meeting", description: "Назначить встречу" },
  { command: "remind", description: "Напомнить незаполнившим (админ)" },
  { command: "link", description: "Открыть группу на сайте" },
  { command: "lang", description: "Язык / Тіл / Language" },
  { command: "help", description: "Что умеет бот" },
];

async function call(token, method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return response.json();
}

async function main() {
  const token = (process.env.BOT_TOKEN ?? "").trim();
  if (!token) {
    log("BOT_TOKEN не задан — сайт собран без телеграм-бота.");
    return;
  }

  // Регистрируем вебхук только на продакшен-сборке Vercel. Превью-деплой
  // получает свой адрес на каждый коммит, а локальная сборка — вообще localhost;
  // и то, и другое увело бы работающего бота с рабочего домена.
  const env = process.env.VERCEL_ENV;
  if (env !== "production" && !FORCED) {
    log(
      env
        ? `окружение ${env} — вебхук не трогаем (npm run bot:webhook, чтобы всё же зарегистрировать).`
        : "локальная сборка — вебхук не трогаем (npm run bot:webhook, чтобы зарегистрировать вручную).",
    );
    return;
  }

  const base = siteUrl();
  if (!base) {
    log("не удалось определить адрес сайта — задай NEXT_PUBLIC_SITE_URL.");
    return;
  }

  const url = `${base}/api/telegram/webhook`;
  const result = await call(token, "setWebhook", {
    url,
    secret_token: webhookSecret(token),
    allowed_updates: ["message", "callback_query", "my_chat_member"],
    drop_pending_updates: true,
  });

  if (!result.ok) {
    log(`Telegram отказал: ${result.description ?? "неизвестная ошибка"}`);
    return;
  }

  await call(token, "setMyCommands", {
    commands: PRIVATE_COMMANDS,
    scope: { type: "all_private_chats" },
  });
  await call(token, "setMyCommands", {
    commands: GROUP_COMMANDS,
    scope: { type: "all_group_chats" },
  });

  // Кнопка «Открыть» рядом с полем ввода: сайт запускается как Mini App и входит сам.
  if (base.startsWith("https://")) {
    await call(token, "setChatMenuButton", {
      menu_button: { type: "web_app", text: "Открыть", web_app: { url: base } },
    });
  }

  const me = await call(token, "getMe", {});
  log(`вебхук зарегистрирован: ${url}${me.ok ? ` (бот @${me.result.username})` : ""}`);
}

main().catch((error) => {
  // Сборка не должна падать из-за недоступного Telegram.
  log(`не удалось зарегистрировать вебхук: ${error?.message ?? error}`);
});
