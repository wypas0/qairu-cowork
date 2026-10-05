// Сайт и бот локально, с настоящим Telegram: npm run dev:tg
//
// Telegram не достучится до localhost, поэтому между ним и Mac — быстрый туннель
// Cloudflare (https://<случайное>.trycloudflare.com, без аккаунта). Скрипт:
//   1. проверяет токен тестового бота из .env.local и что это не боевой бот;
//   2. поднимает PGlite с данными в .pglite/ — группы и вход переживают перезапуск;
//   3. открывает туннель и запускает next dev с адресом туннеля;
//   4. регистрирует вебхук, меню команд и кнопку мини-аппа на этот адрес;
//   5. по Ctrl+C снимает вебхук, чтобы Telegram не стучался в закрытый туннель.
//
// Адрес туннеля новый при каждом запуске — вебхук и кнопка «Открыть»
// перерегистрируются сами. Токен читается только из окружения и никуда не пишется.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const PORT = Number(process.env.PORT || 3100);
const DB_PORT = PORT + 2345; // та же схема, что у e2e-server: демо на 3200 держит 5545
const ROOT = new URL("../../", import.meta.url);
const token = (process.env.BOT_TOKEN ?? "").trim();

function say(message) {
  console.log(`[dev:tg] ${message}`);
}

function stop(message) {
  console.error(`[dev:tg] ${message}`);
  process.exit(1);
}

async function telegram(method, payload = {}) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return response.json();
}

// ---------- 1. бот ----------
if (!token) {
  stop(`в .env.local нет BOT_TOKEN. Заведи тестового бота:
  1. @BotFather → /newbot → имя и username на «bot», например qairu_cowork_dev_bot;
  2. /setjoingroups → этот бот → Enable (иначе не добавить в группу);
  3. токен из ответа BotFather — в .env.local строкой BOT_TOKEN=…;
  4. снова npm run dev:tg.`);
}

const me = await telegram("getMe");
if (!me.ok) stop(`Telegram не принял токен: ${me.description ?? "ошибка"}. Проверь BOT_TOKEN в .env.local.`);
const bot = me.result.username;

// Боевой бот живёт на вебхуке Vercel. Перехватить его здесь — значит отключить
// бота у всех пользователей, поэтому чужой постоянный вебхук не трогаем.
const info = await telegram("getWebhookInfo");
const current = info.ok ? info.result.url : "";
if (current && !/\.trycloudflare\.com\//.test(current) && process.env.QAIRU_TAKE_WEBHOOK !== "1") {
  stop(`у @${bot} уже есть рабочий вебхук ${current}.
  Похоже, это боевой бот — локалка его отключила бы. Заведи отдельного тестового бота.
  Если это точно твой тестовый бот, запусти с QAIRU_TAKE_WEBHOOK=1.`);
}
say(`бот @${bot}`);

// ---------- 2. база ----------
const dataDir = new URL(".pglite/", ROOT);
const db = await PGlite.create(dataDir.pathname);
// Свой учёт миграций: база живёт между запусками, а новые файлы из drizzle/
// должны накатываться по одному разу.
await db.exec("create table if not exists _dev_migrations (name text primary key, applied_at timestamptz default now())");
const done = new Set((await db.query("select name from _dev_migrations")).rows.map((row) => row.name));
const migrations = new URL("drizzle/", ROOT);
const files = (await readdir(migrations)).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
for (const file of files.filter((name) => !done.has(name))) {
  const sql = await readFile(new URL(file, migrations), "utf8");
  for (const statement of sql.split("--> statement-breakpoint")) {
    if (statement.trim()) await db.exec(statement);
  }
  await db.query("insert into _dev_migrations (name) values ($1)", [file]);
  say(`миграция ${file}`);
}
const pg = new PGLiteSocketServer({ db, port: DB_PORT, host: "127.0.0.1" });
await pg.start();
say(`база .pglite/ на 127.0.0.1:${DB_PORT}`);

// ---------- 3. туннель и сайт ----------
const children = [];

const cloudflared = existsSync(new URL(".tools/cloudflared", ROOT)) ? new URL(".tools/cloudflared", ROOT).pathname : "cloudflared";
const tunnel = spawn(cloudflared, ["tunnel", "--no-autoupdate", "--url", `http://localhost:${PORT}`], {
  stdio: ["ignore", "pipe", "pipe"],
});
children.push(tunnel);
tunnel.on("error", () => stop("не найден cloudflared: положи его в .tools/ или в PATH."));

const publicUrl = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("туннель не поднялся за 40 секунд")), 40_000);
  const scan = (chunk) => {
    const match = String(chunk).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match) {
      clearTimeout(timer);
      resolve(match[0]);
    }
  };
  tunnel.stdout.on("data", scan);
  tunnel.stderr.on("data", scan);
}).catch((error) => stop(error.message));
say(`туннель ${publicUrl}`);

const next = spawn(new URL("node_modules/.bin/next", ROOT).pathname, ["dev", "-p", String(PORT)], {
  cwd: ROOT.pathname,
  stdio: "inherit",
  env: {
    ...process.env,
    DATABASE_URL: `postgres://postgres:postgres@127.0.0.1:${DB_PORT}/postgres`,
    DATABASE_POOL_MAX: "1", // PGlite держит одно соединение
    NEXT_PUBLIC_SITE_URL: publicUrl,
  },
});
children.push(next);

async function waitFor(url, label) {
  for (let i = 0; i < 90; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  stop(`${label} не ответил за 90 секунд: ${url}`);
}
await waitFor(`http://localhost:${PORT}/api/healthz`, "сайт");
// Адрес туннеля появляется в DNS не мгновенно — ждём, пока он отвечает снаружи.
await waitFor(`${publicUrl}/api/healthz`, "туннель");

// ---------- 4. вебхук ----------
const secret =
  (process.env.TELEGRAM_WEBHOOK_SECRET ?? "").trim() ||
  createHash("sha256").update(`qairu-webhook:${token}`).digest("hex").slice(0, 48);
const setup = await fetch(
  `http://localhost:${PORT}/api/telegram/setup?secret=${secret}&url=${encodeURIComponent(publicUrl)}`,
).then((r) => r.json());
if (!setup.ok) stop(`вебхук не зарегистрирован: ${setup.detail ?? "ошибка"}`);

say("");
say(`готово. Сайт:  ${publicUrl}`);
say(`        Бот:   https://t.me/${bot}  → /start, кнопка «Открыть» — мини-апп`);
say(`        Локально (без Telegram): http://localhost:${PORT}`);
say("Ctrl+C — остановить и снять вебхук.");

// ---------- 5. выход ----------
let leaving = false;
async function shutdown() {
  if (leaving) return;
  leaving = true;
  say("снимаю вебхук…");
  await telegram("deleteWebhook").catch(() => {});
  for (const child of children) child.kill("SIGTERM");
  await pg.stop().catch(() => {});
  await db.close().catch(() => {});
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
next.on("exit", shutdown);
tunnel.on("exit", () => {
  if (!leaving) say("туннель закрылся — перезапусти npm run dev:tg");
  shutdown();
});
