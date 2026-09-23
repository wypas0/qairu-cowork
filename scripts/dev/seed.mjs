// Наполнение локальной базы для smoke-теста.
import crypto from "node:crypto";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
const slug = "smoke001";
const chatId = -(10 ** 15) - 111;
const amir = -(10 ** 15) - 222;
const asel = -(10 ** 15) - 333;
const bolat = -(10 ** 15) - 444;
const token = crypto.randomBytes(32).toString("base64url");

await sql`delete from chats where chat_id = ${chatId}`;
await sql`delete from users where user_id in (${amir}, ${asel}, ${bolat})`;

// Амир создал группу и её администратор; Болат ещё не заполнил расписание.
await sql`insert into chats (chat_id, slug, origin, title, lang, tz, created_by)
          values (${chatId}, ${slug}, 'web', 'ИС-21', 'ru', 'Asia/Almaty', ${amir})`;
await sql`insert into users (user_id, full_name, lang, is_web) values
          (${amir}, 'Амир', 'ru', true), (${asel}, 'Асель', 'ru', true), (${bolat}, 'Болат', 'ru', true)`;
await sql`insert into memberships (chat_id, user_id, role) values
          (${chatId}, ${amir}, 'admin'), (${chatId}, ${asel}, 'member'), (${chatId}, ${bolat}, 'member')`;
await sql`insert into web_sessions (token_hash, user_id)
          values (${crypto.createHash("sha256").update(token).digest("hex")}, ${amir})`;

// Амир занят по понедельникам, Асель свободна всю неделю.
await sql`insert into busy_slots (user_id, weekday, start_min, end_min, label, kind, source)
          values (${amir}, 0, 540, 630, 'Матан', 'class', 'web')`;
await sql`insert into schedule_state (user_id, filled) values (${amir}, true), (${asel}, true)`;

const start = new Date(Date.now() + 3 * 86400000);
const [meeting] = await sql`insert into meetings
  (chat_id, initiator_id, place, when_text, when_start, goal, invitees, status)
  values (${chatId}, ${amir}, 'Библиотека', 'через три дня', ${start}, 'Разбор задач',
          ${`${amir},${asel},${bolat}`}, 'open') returning id`;

console.log(JSON.stringify({ slug, token, meetingId: meeting.id }));
await sql.end();
