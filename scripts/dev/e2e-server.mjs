// Сайт с наполненной базой для сквозных тестов и ручной проверки глазами.
//
//   node scripts/dev/e2e-server.mjs [порт сайта] [--fake-bot]
//
// Поднимает PGlite в памяти, накатывает миграции, заводит группу «ИС-21»
// (пять человек, разные расписания и отметки «неудобно», встреча через
// 100 минут, прошедшая встреча с итогами) и вторую группу «Дипломники»,
// пишет {slug, token, tokenEmpty, ownerToken, ownerCode, url} в e2e/.state.json и запускает
// `next start` на собранном проекте (`npx next build` — заранее). token —
// вход Амиром, tokenEmpty — Болатом, у которого ещё нет расписания,
// ownerToken — кука консоли владельца (Амир — владелец, OWNER_IDS), ownerCode —
// его живой код входа в консоль.
// Ctrl+C гасит всё.
//
// --fake-bot — для нагрузочного теста бота (scripts/load/README.md): у сайта
// появляется выдуманный BOT_TOKEN и случайный секрет вебхука (пишется в
// .state.json как bot.secret), а все вызовы api.telegram.org перехватывает
// заглушка scripts/load/tg-blackhole.mjs — в Telegram не уходит ничего.
// Без флага бота нет (BOT_TOKEN пустой), как раньше.

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import postgres from "postgres";

const args = process.argv.slice(2);
const SITE_PORT = Number(args.find((arg) => /^\d+$/.test(arg)) ?? 3200);
const FAKE_BOT = args.includes("--fake-bot");
const DB_PORT = SITE_PORT + 2345;
const TZ = "Asia/Almaty"; // UTC+5, без перевода часов
const DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${DB_PORT}/postgres`;

const db = await new PGlite();
const dir = new URL("../../drizzle/", import.meta.url);
for (const file of (await readdir(dir)).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort()) {
  for (const statement of (await readFile(new URL(file, dir), "utf8")).split("--> statement-breakpoint")) {
    if (statement.trim()) await db.exec(statement.trim());
  }
}
const server = new PGLiteSocketServer({ db, port: DB_PORT, host: "127.0.0.1" });
await server.start();

// ---------- наполнение ----------
const sql = postgres(DATABASE_URL, { prepare: false, max: 1 });
const now = Date.now();
const wall = new Date(now + 5 * 3_600_000); // стенные часы Алматы
const today = wall.toISOString().slice(0, 10);
const weekday = (wall.getUTCDay() + 6) % 7;
const atDay = (offset, minutes) => {
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + offset, 0, minutes) - 5 * 3_600_000);
};

const chat = -(10 ** 15) - 111;
const chat2 = -(10 ** 15) - 555;
// Группы, где Амира нет: вступление по ссылке — прямой переход и переход с чужого сайта.
const [chat3, chat4, chat5] = [-(10 ** 15) - 777, -(10 ** 15) - 888, -(10 ** 15) - 999];
// Группа из Telegram для теста удаления из консоли.
const chat6 = -(10 ** 12) - 606;
const [amir, asel, bolat, dana, erlan] = [1001, 1002, 1003, 1004, 1005];
const token = crypto.randomBytes(32).toString("base64url");
// Болат ещё не заполнил расписание: вход им — пустой редактор.
const tokenEmpty = crypto.randomBytes(32).toString("base64url");

await sql`insert into chats (chat_id, slug, origin, title, lang, tz, created_by)
          values (${chat}, 'smoke001', 'web', 'ИС-21', 'ru', ${TZ}, ${amir}),
                 (${chat2}, 'smoke002', 'web', 'Дипломники', 'ru', ${TZ}, ${asel}),
                 (${chat3}, 'smoke003', 'web', 'Кружок', 'ru', ${TZ}, ${asel}),
                 (${chat4}, 'smoke004', 'web', 'Сборная', 'ru', ${TZ}, ${asel}),
                 (${chat5}, 'smoke005', 'web', 'Хор', 'ru', ${TZ}, ${asel}),
                 (${chat6}, 'smoke006', 'telegram', 'Старый чат', 'ru', ${TZ}, ${erlan})`;
// Ники в Telegram — у всех, кроме Болата: консоль показывает и ссылку на профиль, и «без ника».
await sql`insert into users (user_id, username, full_name, lang, is_web) values
          (${amir}, 'amir_k', 'Амир', 'ru', false), (${asel}, 'asel_n', 'Асель', 'ru', false),
          (${bolat}, null, 'Болат', 'ru', false), (${dana}, 'dana_s', 'Дана', 'ru', false),
          (${erlan}, 'erlan_t', 'Ерлан', 'ru', false)`;
await sql`insert into memberships (chat_id, user_id, role) values
          (${chat}, ${amir}, 'admin'), (${chat}, ${asel}, 'member'), (${chat}, ${bolat}, 'member'),
          (${chat}, ${dana}, 'member'), (${chat}, ${erlan}, 'member'),
          (${chat2}, ${amir}, 'member'), (${chat2}, ${asel}, 'admin'),
          (${chat3}, ${asel}, 'admin'), (${chat4}, ${asel}, 'admin'), (${chat5}, ${asel}, 'admin'),
          (${chat6}, ${erlan}, 'admin')`;
await sql`insert into web_sessions (token_hash, user_id)
          values (${crypto.createHash("sha256").update(token).digest("hex")}, ${amir}),
                 (${crypto.createHash("sha256").update(tokenEmpty).digest("hex")}, ${bolat})`;

const weekly = (user, days, start, end, kind = "class") =>
  days.map((day) => ({ user_id: user, weekday: day, start_min: start, end_min: end, kind, source: "web", label: "" }));
const slots = [
  ...weekly(amir, [0], 9 * 60, 11 * 60),
  ...weekly(asel, [2], 10 * 60, 13 * 60),
  ...weekly(asel, [4], 8 * 60, 10 * 60),
  ...weekly(dana, [0, 1, 2, 3, 4, 5, 6], 20 * 60, 22 * 60),
  ...weekly(erlan, [1, 3], 12 * 60, 15 * 60),
  // «Неудобно»: Асель по утрам в будни, Амир в субботу днём.
  ...weekly(asel, [0, 1, 2, 3], 8 * 60, 9 * 60, "soft"),
  ...weekly(amir, [5], 12 * 60, 16 * 60, "soft"),
];
await sql`insert into busy_slots ${sql(slots)}`;
await sql`insert into schedule_state (user_id, filled) values
          (${amir}, true), (${asel}, true), (${dana}, true), (${erlan}, true)`;

const everyone = [amir, asel, bolat, dana, erlan].join(",");
const [soon] = await sql`insert into meetings (chat_id, initiator_id, place, when_text, when_start, goal, invitees, status)
  values (${chat}, ${asel}, 'Коворкинг', 'скоро', ${new Date(now + 100 * 60_000)}, 'Созвон по проекту', ${everyone}, 'open')
  returning id`;
await sql`insert into meeting_responses (meeting_id, user_id, answer) values (${soon.id}, ${asel}, 'yes'), (${soon.id}, ${dana}, 'yes')`;
const inTwoDays = atDay(2, 15 * 60);
await sql`insert into meetings (chat_id, initiator_id, place, when_text, when_start, goal, invitees, status)
  values (${chat}, ${amir}, 'Библиотека', ${"15:00–16:30"}, ${inTwoDays}, 'Разбор задач', ${everyone}, 'open')`;
const [past] = await sql`insert into meetings (chat_id, initiator_id, place, when_text, when_start, goal, invitees, status, summary, summary_by, summary_at)
  values (${chat}, ${amir}, 'Аудитория 305', ${"15:00–16:30"}, ${atDay(-3, 15 * 60)}, 'Подготовка к защите', ${everyone}, 'open',
          'Решили: слайды — Асель, отчёт — Амир. Следующая встреча в четверг.', ${amir}, ${new Date(now - 2 * 86_400_000)})
  returning id`;
await sql`insert into meeting_responses (meeting_id, user_id, answer) values (${past.id}, ${amir}, 'yes')`;
await sql`insert into meetings (chat_id, initiator_id, place, when_text, when_start, goal, invitees, status)
  values (${chat2}, ${asel}, 'Каф. ИС', 'x', ${atDay(1, 11 * 60)}, 'Предзащита', ${`${amir},${asel}`}, 'open'),
         (${chat2}, ${asel}, 'Zoom', 'x', ${atDay(4, 18 * 60)}, 'Консультация', ${`${amir},${asel}`}, 'open')`;
// Консоль владельца: Амир — владелец (OWNER_IDS ниже), у него открытая сессия
// консоли, привязанная к его сессии сайта. Бота нет — код не прислать, поэтому
// сессия кладётся прямо в базу, как её выдал бы верный код. Плюс журнал и прогон cron.
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
const ownerToken = crypto.randomBytes(32).toString("base64url");
await sql`insert into owner_sessions (token_hash, user_id, web_token_hash, expires_at)
          values (${sha(ownerToken)}, ${amir}, ${sha(token)}, ${new Date(now + 12 * 3_600_000)})`;
await sql`insert into owner_audit (user_id, event, ok, ip_hash, ua_hash, device, created_at) values
          (${amir}, 'code_sent', true, ${sha("ip:a")}, ${sha("ua:a")}, 'Chrome · Windows', ${new Date(now - 120_000)}),
          (${amir}, 'wrong', false, ${sha("ip:a")}, ${sha("ua:a")}, 'Chrome · Windows', ${new Date(now - 90_000)}),
          (${amir}, 'login', true, ${sha("ip:a")}, ${sha("ua:a")}, 'Chrome · Windows', ${new Date(now - 60_000)})`;
// Живой код входа в консоль: бота нет, поэтому код кладётся в базу, а ключ HMAC
// задаётся явно (OWNER_CONSOLE_SECRET ниже) — так e2e проходит ввод кода целиком.
const ownerSecret = crypto.randomBytes(32).toString("hex");
const ownerCode = "424242";
const ownerSalt = crypto.randomBytes(16).toString("hex");
// Тот же формат, что у hashOwnerCode в src/lib/ownerConsole.ts.
const ownerCodeHash = crypto
  .createHmac("sha256", ownerSecret)
  .update(["code", `${amir}:${ownerSalt}:${ownerCode}`].join("\n"))
  .digest("hex");
await sql`insert into owner_login_codes (user_id, code_hash, salt, expires_at)
          values (${amir}, ${ownerCodeHash}, ${ownerSalt}, ${new Date(now + 60 * 60_000)})`;
await sql`insert into bot_state (key, data) values ('cron:reminders', ${sql.json({
  at: now - 300_000, ok: true, due: 1, sent: 1, attendance: 0, calendars: 0, sessions: 0,
  week: { since: now - 3 * 86_400_000, due: 9, sent: 8 },
})})`;
// «Качество за 24 часа»: часовые корзины метрик (формат — src/core/metrics.ts).
// Cron раз в 5 минут, но с перерывом в 40 минут три часа назад; сохранение
// расписания медленное (p95 > 2 с); одно напоминание опоздало, одно не дошло.
const hourKey = (at) => new Date(at).toISOString().slice(0, 13);
const buckets = new Map();
const bump = (name, at, data) => {
  const key = `metric:${name}:${hourKey(at)}`;
  const into = buckets.get(key) ?? {};
  for (const [field, value] of Object.entries(data)) {
    into[field] = Array.isArray(value) ? [...(into[field] ?? []), ...value] : (into[field] ?? 0) + value;
  }
  buckets.set(key, into);
};
for (let at = now - 24 * 3_600_000; at <= now - 60_000; at += 5 * 60_000) {
  if (at > now - 3 * 3_600_000 - 40 * 60_000 && at < now - 3 * 3_600_000) continue;
  bump("cron", at, { n: 1, sum: 900, budget: 0, err: 0, at: [Math.round(at / 1000)] });
}
for (let hour = 0; hour < 24; hour += 1) {
  const at = now - hour * 3_600_000;
  bump("webhook", at, { n: 12, sum: 1800, b1: 4, b2: 7, b3: 1 });
  bump("board", at, { n: 6, sum: 1500, b2: 3, b3: 3 });
  bump("state", at, { n: 9, sum: 900, b1: 6, b2: 3 });
  bump("tg", at, { n: 14, sum: 2100, b1: 3, b2: 10, b3: 1, ...(hour === 5 ? { forbidden: 1 } : {}) });
}
bump("schedule", now, { n: 5, sum: 12_000, b3: 2, b6: 3 });
bump("reminder", now - 2 * 3_600_000, { n: 3, sum: 600, b0: 1, b2: 1, b5: 1, late: 1 });
bump("reminder", now - 4 * 3_600_000, { failed: 1 });
for (const [key, data] of buckets) {
  await sql`insert into bot_state (key, data) values (${key}, ${sql.json(data)})`;
}
await sql.end();

const url = `http://localhost:${SITE_PORT}`;
// Выдуманный бот: токен не настоящий, секрет вебхука — случайный на каждый запуск.
// По совпадению секрета нагрузочный тест понимает, что перед ним этот сервер с заглушкой.
const bot = FAKE_BOT ? { fake: true, secret: crypto.randomBytes(24).toString("hex") } : null;
const blackhole = new URL("../load/tg-blackhole.mjs", import.meta.url).href;
const state = { slug: "smoke001", token, tokenEmpty, ownerToken, ownerCode, url, weekday, bot };
await mkdir(new URL("../../e2e/", import.meta.url), { recursive: true });
await writeFile(new URL("../../e2e/.state.json", import.meta.url), JSON.stringify(state));
console.log(`[e2e] база на ${DB_PORT}, сайт на ${url}, вход: кука qairu_token=${token}`);
if (bot) console.log("[e2e] --fake-bot: бот включён, Telegram подменён заглушкой");

// ---------- сайт ----------
const next = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(SITE_PORT)], {
  stdio: "inherit",
  // PGlite принимает одно соединение — пул сайта под это.
  // Необязательные переменные — пустыми строками, как их хранит Vercel: пустая
  // должна значить «не задана» (так однажды упала консоль на DEFAULT_TZ="").
  env: {
    ...process.env,
    DATABASE_URL,
    DATABASE_POOL_MAX: "1",
    NEXT_PUBLIC_SITE_URL: url,
    BOT_TOKEN: bot ? "123456789:fake-load-test-token" : "",
    DESIGN_SPECIMEN: "1",
    OWNER_IDS: String(amir),
    ALERT_CHAT_ID: "",
    OWNER_CONSOLE_SECRET: ownerSecret,
    DEFAULT_TZ: "",
    WEB_BASE_URL: "",
    TELEGRAM_WEBHOOK_SECRET: bot ? bot.secret : "",
    CRON_SECRET: "",
    ...(bot ? { NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${blackhole}`.trim() } : {}),
  },
});
const stop = async () => {
  next.kill();
  await server.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
next.on("exit", async (code) => {
  await server.stop();
  process.exit(code ?? 0);
});
