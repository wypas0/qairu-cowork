/**
 * Модели данных QairuCowork (Drizzle ORM, PostgreSQL).
 *
 * Имена таблиц и колонок совпадают с прежней SQLAlchemy-схемой: базу от
 * Python-версии можно перелить дампом без переименований.
 *
 * Время всегда `timestamptz` и всегда читается как `Date` в UTC. В SQLite это
 * приходилось чинить руками (смещение терялось, и время встречи уезжало на
 * пять часов) — Postgres хранит смещение сам.
 */

import { relations } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  userId: bigint("user_id", { mode: "number" }).primaryKey(),
  username: varchar("username", { length: 64 }),
  fullName: varchar("full_name", { length: 256 }).notNull().default(""),
  lang: varchar("lang", { length: 8 }).notNull().default("ru"),
  // Пользователь, заведённый на сайте без Telegram. Его user_id — синтетический
  // (см. newWebId): Telegram такие никогда не выдаёт, коллизий быть не может.
  isWeb: boolean("is_web").notNull().default(false),
  createdAt: createdAt(),
});

export const chats = pgTable("chats", {
  chatId: bigint("chat_id", { mode: "number" }).primaryKey(),
  // Короткий публичный идентификатор для ссылки /g/<slug>. Один и тот же
  // объект Chat — это и группа в Telegram, и группа на сайте.
  slug: varchar("slug", { length: 24 }).unique(),
  origin: varchar("origin", { length: 16 }).notNull().default("telegram"), // telegram | web
  title: varchar("title", { length: 256 }).notNull().default(""),
  lang: varchar("lang", { length: 8 }).notNull().default("ru"),
  tz: varchar("tz", { length: 64 }).notNull().default("Asia/Almaty"),
  dayStartMin: integer("day_start_min").notNull().default(8 * 60),
  dayEndMin: integer("day_end_min").notNull().default(22 * 60),
  minSlotMin: integer("min_slot_min").notNull().default(30),
  travelBufferMin: integer("travel_buffer_min").notNull().default(0), // буфер на дорогу
  semesterStart: date("semester_start"), // отсчёт чётности недель
  reminderMin: integer("reminder_min").notNull().default(30), // напоминание до встречи
  createdAt: createdAt(),
});

export const memberships = pgTable(
  "memberships",
  {
    chatId: bigint("chat_id", { mode: "number" })
      .notNull()
      .references(() => chats.chatId, { onDelete: "cascade" }),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.userId, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.chatId, table.userId] })],
);

/**
 * Занятость. Вид определяется тем, какие поля не NULL:
 *   weekday + week_parity IS NULL — каждую неделю;
 *   weekday + week_parity 0/1     — через неделю (числитель / знаменатель);
 *   specific_date                 — разовая (экзамен, отработка);
 *   date_from..date_to            — период (сессия, поездка).
 */
export const busySlots = pgTable(
  "busy_slots",
  {
    id: serial("id").primaryKey(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.userId, { onDelete: "cascade" }),
    weekday: integer("weekday"), // 0=Пн … 6=Вс
    specificDate: date("specific_date"),
    dateFrom: date("date_from"), // диапазон: сессия, поездка
    dateTo: date("date_to"),
    weekParity: integer("week_parity"), // null=каждую, 0=числ., 1=знам.
    startMin: integer("start_min").notNull(),
    endMin: integer("end_min").notNull(),
    label: varchar("label", { length: 64 }).notNull().default(""),
    kind: varchar("kind", { length: 16 }).notNull().default("class"), // class|work|sport|exam|other
    source: varchar("source", { length: 16 }).notNull().default("wizard"), // wizard|import|csv|web
    createdAt: createdAt(),
  },
  (table) => [
    index("ix_busy_slots_user_id").on(table.userId),
    index("ix_busy_user_weekday").on(table.userId, table.weekday),
  ],
);

/**
 * Отметка «пользователь завершил заполнение расписания».
 * Нужна, чтобы отличать «свободен всю неделю» от «не заполнял».
 */
export const scheduleState = pgTable("schedule_state", {
  userId: bigint("user_id", { mode: "number" })
    .primaryKey()
    .references(() => users.userId, { onDelete: "cascade" }),
  filled: boolean("filled").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Персональная ссылка/кука сайта. Аккаунтов и паролей нет — только токен. */
export const webSessions = pgTable(
  "web_sessions",
  {
    token: varchar("token", { length: 64 }).primaryKey(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.userId, { onDelete: "cascade" }),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("ix_web_sessions_user_id").on(table.userId)],
);

export const meetings = pgTable(
  "meetings",
  {
    id: serial("id").primaryKey(),
    chatId: bigint("chat_id", { mode: "number" }).notNull(),
    initiatorId: bigint("initiator_id", { mode: "number" }).notNull(),
    place: varchar("place", { length: 256 }).notNull().default(""),
    whenText: varchar("when_text", { length: 256 }).notNull().default(""),
    whenStart: timestamp("when_start", { withTimezone: true }),
    goal: text("goal").notNull().default(""),
    chatMessageId: bigint("chat_message_id", { mode: "number" }),
    invitees: text("invitees").notNull().default(""), // "123,456" — id приглашённых
    status: varchar("status", { length: 16 }).notNull().default("open"), // open|cancelled|done
    // На Vercel нет живого процесса с JobQueue: напоминание рассылает cron,
    // и этот флаг не даёт отправить его дважды.
    reminderSent: boolean("reminder_sent").notNull().default(false),
    createdAt: createdAt(),
  },
  (table) => [index("ix_meetings_chat_id").on(table.chatId)],
);

export const meetingResponses = pgTable(
  "meeting_responses",
  {
    meetingId: integer("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    userId: bigint("user_id", { mode: "number" }).notNull(),
    answer: varchar("answer", { length: 16 }).notNull(), // yes | no | change
    comment: text("comment").notNull().default(""),
    respondedAt: timestamp("responded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.meetingId, table.userId] })],
);

/**
 * Состояние диалогов бота.
 *
 * У python-telegram-bot это делал PicklePersistence в файле рядом с процессом.
 * Лямбда на Vercel живёт один запрос и файловой системы между вызовами не имеет,
 * поэтому черновики встреч и шаги мастера лежат в БД.
 */
export const botState = pgTable("bot_state", {
  key: varchar("key", { length: 128 }).primaryKey(),
  data: jsonb("data").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const usersRelations = relations(users, ({ many }) => ({
  slots: many(busySlots),
}));

export const busySlotsRelations = relations(busySlots, ({ one }) => ({
  user: one(users, { fields: [busySlots.userId], references: [users.userId] }),
}));

export const meetingsRelations = relations(meetings, ({ many }) => ({
  responses: many(meetingResponses),
}));

export const meetingResponsesRelations = relations(meetingResponses, ({ one }) => ({
  meeting: one(meetings, { fields: [meetingResponses.meetingId], references: [meetings.id] }),
}));

export type User = typeof users.$inferSelect;
export type Chat = typeof chats.$inferSelect;
export type BusySlot = typeof busySlots.$inferSelect;
export type Meeting = typeof meetings.$inferSelect;
export type MeetingResponse = typeof meetingResponses.$inferSelect;

/** Как показывать человека в списках: имя, иначе @username, иначе id. */
export function displayName(user: Pick<User, "fullName" | "username" | "userId">): string {
  return user.fullName || (user.username ? `@${user.username}` : String(user.userId));
}
