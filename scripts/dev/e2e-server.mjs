// Сайт с наполненной базой для сквозных тестов и ручной проверки глазами.
//
//   node scripts/dev/e2e-server.mjs [порт сайта]
//
// Поднимает PGlite в памяти, накатывает миграции, заводит группу «ИС-21»
// (пять человек, разные расписания и отметки «неудобно», встреча через
// 100 минут, прошедшая встреча с итогами) и вторую группу «Дипломники»,
// пишет {slug, token, url} в e2e/.state.json и запускает `next start` на
// собранном проекте (`npx next build` — заранее). Ctrl+C гасит всё.

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import postgres from "postgres";

const SITE_PORT = Number(process.argv[2] ?? 3200);
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
const [chat3, chat4] = [-(10 ** 15) - 777, -(10 ** 15) - 888];
const [amir, asel, bolat, dana, erlan] = [1001, 1002, 1003, 1004, 1005];
const token = crypto.randomBytes(32).toString("base64url");

await sql`insert into chats (chat_id, slug, origin, title, lang, tz, created_by)
          values (${chat}, 'smoke001', 'web', 'ИС-21', 'ru', ${TZ}, ${amir}),
                 (${chat2}, 'smoke002', 'web', 'Дипломники', 'ru', ${TZ}, ${asel}),
                 (${chat3}, 'smoke003', 'web', 'Кружок', 'ru', ${TZ}, ${asel}),
                 (${chat4}, 'smoke004', 'web', 'Сборная', 'ru', ${TZ}, ${asel})`;
await sql`insert into users (user_id, full_name, lang, is_web) values
          (${amir}, 'Амир', 'ru', false), (${asel}, 'Асель', 'ru', false), (${bolat}, 'Болат', 'ru', false),
          (${dana}, 'Дана', 'ru', false), (${erlan}, 'Ерлан', 'ru', false)`;
await sql`insert into memberships (chat_id, user_id, role) values
          (${chat}, ${amir}, 'admin'), (${chat}, ${asel}, 'member'), (${chat}, ${bolat}, 'member'),
          (${chat}, ${dana}, 'member'), (${chat}, ${erlan}, 'member'),
          (${chat2}, ${amir}, 'member'), (${chat2}, ${asel}, 'admin'),
          (${chat3}, ${asel}, 'admin'), (${chat4}, ${asel}, 'admin')`;
await sql`insert into web_sessions (token_hash, user_id)
          values (${crypto.createHash("sha256").update(token).digest("hex")}, ${amir})`;

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
await sql.end();

const url = `http://localhost:${SITE_PORT}`;
const state = { slug: "smoke001", token, url, weekday };
await mkdir(new URL("../../e2e/", import.meta.url), { recursive: true });
await writeFile(new URL("../../e2e/.state.json", import.meta.url), JSON.stringify(state));
console.log(`[e2e] база на ${DB_PORT}, сайт на ${url}, вход: кука qairu_token=${token}`);

// ---------- сайт ----------
const next = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(SITE_PORT)], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL, NEXT_PUBLIC_SITE_URL: url, BOT_TOKEN: "" },
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
