/**
 * Модели данных QairuCowork (Drizzle ORM, PostgreSQL).
 *
 * Имена таблиц и колонок совпадают с прежней SQLAlchemy-схемой: базу от
 * Python-версии можно перелить дампом без переименований.
 *
 * Время всегда `timestamptz` и всегда читается как `Date` в UTC. В SQLite это
 * приходилось чинить руками (смещение терялось, и время встречи уезжало на
 * пять часов) — Postgres хранит смещение сам.
 *
 * Каждая таблица — под RLS без единой политики (`.enableRLS()`). Сайт и бот
 * ходят в базу владельцем таблиц (роль postgres), на него RLS не действует.
 * А Data API Supabase — роли anon и authenticated с публичным ключом проекта —
 * не видит ни строки. Новой таблице тоже нужен `.enableRLS()`: это проверяет
 * tests/schema.test.ts.
 */

import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
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
  // Настоящее имя, которое человек написал в профиле. Отдельно от full_name:
  // то — имя из Telegram, его бот обновляет сам; это показывается рядом с ним.
  realName: varchar("real_name", { length: 60 }),
  // Подписка на личный календарь (.ics по ссылке из Google, Outlook, портала
  // вуза): занятость из него обновляется сама. Ссылка — секрет человека,
  // наружу она не отдаётся.
  calendarUrl: text("calendar_url"),
  calendarSyncedAt: timestamp("calendar_synced_at", { withTimezone: true }),
  // Почему последняя загрузка не удалась: код ошибки, а не текст — его
  // переводит сайт. NULL — всё в порядке.
  calendarError: varchar("calendar_error", { length: 32 }),
  // Друзья (0012): видят ли они группы человека — каждую можно ещё скрыть
  // отдельно (memberships.hidden_from_friends) — и общее свободное время с ним.
  friendsSeeGroups: boolean("friends_see_groups").notNull().default(true),
  friendsSeeFree: boolean("friends_see_free").notNull().default(true),
  // Находится ли человек поиском друзей по @нику. Нет — добавить его можно
  // только по его личной ссылке или из общей группы.
  findable: boolean("findable").notNull().default(true),
  createdAt: createdAt(),
}, (table) => [
  // Поиск друзей и вход по нику сравнивают ник без учёта регистра.
  index("ix_users_username_lower").on(sql`lower(${table.username})`),
]).enableRLS();

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
  // Кто создал группу на сайте. Создателя нельзя разжаловать — иначе группа
  // может остаться без единого администратора. У групп из Telegram — NULL:
  // там администраторов назначает сам Telegram.
  createdBy: bigint("created_by", { mode: "number" }),
  createdAt: createdAt(),
}).enableRLS();

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
    role: varchar("role", { length: 16 }).notNull().default("member"), // member | admin
    // Группа скрыта от друзей человека: в его карточке друга её не видно.
    hiddenFromFriends: boolean("hidden_from_friends").notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.chatId, table.userId] }),
    // «Мои группы» на каждой странице и карточка человека в консоли ищут по человеку,
    // а первичный ключ начинается с группы.
    index("ix_memberships_user_id").on(table.userId),
  ],
).enableRLS();

export const ROLE_ADMIN = "admin";
export const ROLE_MEMBER = "member";

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
    // Недельная пара, которая идёт не всегда, а с valid_from по valid_to (триместр
    // из кампуса), и не в даты except_dates («2026-11-02,2026-12-16» — праздники,
    // отменённые пары). NULL — каждую неделю без конца, как раньше.
    validFrom: date("valid_from"),
    validTo: date("valid_to"),
    exceptDates: text("except_dates").notNull().default(""),
    createdAt: createdAt(),
  },
  (table) => [
    index("ix_busy_slots_user_id").on(table.userId),
    index("ix_busy_user_weekday").on(table.userId, table.weekday),
  ],
).enableRLS();

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
  // Откуда последний раз пришло расписание: manual (сетка), photo (файл или
  // фото), campus (расширение кампуса). Правка клеток после импорта его не
  // меняет — расписание всё равно «из кампуса», просто поправленное.
  origin: varchar("origin", { length: 16 }).notNull().default("manual"),
  // Версия расширения кампуса, которым его принесли (для статистики версий).
  extVersion: varchar("ext_version", { length: 16 }),
}).enableRLS();

/**
 * Вход по логину и паролю — необязательный, поверх токена-ссылки.
 *
 * Логин хранится в нижнем регистре. Вместо него можно ввести свой @username
 * из Telegram, но только если аккаунт подтверждён ботом или Mini App
 * (users.is_web = false): иначе любой мог бы назваться чужим ником.
 * Пароль — только хэш scrypt в формате `scrypt$N$r$p$соль$хэш`.
 */
export const credentials = pgTable("credentials", {
  userId: bigint("user_id", { mode: "number" })
    .primaryKey()
    .references(() => users.userId, { onDelete: "cascade" }),
  login: varchar("login", { length: 32 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

/**
 * Фото профиля. Лежит в самой базе: у Vercel нет постоянного диска, а отдельное
 * хранилище ради картинок в пару десятков килобайт не нужно — браузер ужимает
 * фото до 256×256 перед загрузкой. Данные — base64 уже проверенного JPEG, PNG
 * или WebP (SVG не принимается: он может содержать скрипт).
 */
export const avatars = pgTable("avatars", {
  userId: bigint("user_id", { mode: "number" })
    .primaryKey()
    .references(() => users.userId, { onDelete: "cascade" }),
  mime: varchar("mime", { length: 32 }).notNull(),
  data: text("data").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

/**
 * Уведомления на сайте — для тех, до кого не дотянется бот: людей без
 * Telegram и тех, кто ещё не нажал /start. Показываются баннером в группе,
 * пока человек не отреагирует или не закроет их.
 */
export const notices = pgTable(
  "notices",
  {
    id: serial("id").primaryKey(),
    chatId: bigint("chat_id", { mode: "number" })
      .notNull()
      .references(() => chats.chatId, { onDelete: "cascade" }),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.userId, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 24 }).notNull(), // fill_schedule | meeting | meeting_change
    meetingId: integer("meeting_id").references(() => meetings.id, { onDelete: "cascade" }),
    fromUserId: bigint("from_user_id", { mode: "number" }),
    text: text("text").notNull().default(""),
    createdAt: createdAt(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (table) => [index("ix_notices_user_chat").on(table.userId, table.chatId)],
).enableRLS();

/**
 * Сессия сайта (кука `qairu_token`). Выдаётся и после входа по паролю.
 *
 * Хранится только SHA-256 токена: утёкшая таблица — бэкап, лог, чужой доступ
 * к базе — не даёт войти в чужой аккаунт. Сессия без заходов дольше
 * SESSION_IDLE_DAYS (db/queries/web.ts) больше не пускает.
 */
export const webSessions = pgTable(
  "web_sessions",
  {
    tokenHash: varchar("token_hash", { length: 64 }).primaryKey(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.userId, { onDelete: "cascade" }),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("ix_web_sessions_user_id").on(table.userId)],
).enableRLS();

/**
 * Встреча — в группе (chat_id) или вдвоём с другом (0013): тогда группы нет,
 * а with_user — второй человек, не создатель. Одно из двух, не оба — это
 * держит ck_meetings_pair. У встречи вдвоём chat_message_id — карточка в
 * личке с другом: её перерисовывают ответы и отмена.
 */
export const meetings = pgTable(
  "meetings",
  {
    id: serial("id").primaryKey(),
    chatId: bigint("chat_id", { mode: "number" }),
    withUser: bigint("with_user", { mode: "number" }),
    initiatorId: bigint("initiator_id", { mode: "number" }).notNull(),
    place: varchar("place", { length: 256 }).notNull().default(""),
    whenText: varchar("when_text", { length: 256 }).notNull().default(""),
    whenStart: timestamp("when_start", { withTimezone: true }),
    // Сколько длится встреча, минуты. null — у встреч, созданных раньше: им
    // длительность достаётся из текста «15:00–16:30» (см. meetingDurationMin).
    durationMin: integer("duration_min"),
    goal: text("goal").notNull().default(""),
    chatMessageId: bigint("chat_message_id", { mode: "number" }),
    invitees: text("invitees").notNull().default(""), // "123,456" — id приглашённых
    status: varchar("status", { length: 16 }).notNull().default("open"), // open|cancelled|done
    // На Vercel нет живого процесса с JobQueue: напоминание рассылает cron,
    // и этот флаг не даёт отправить его дважды.
    reminderSent: boolean("reminder_sent").notNull().default(false),
    // Повторяющаяся встреча: каждую неделю в тот же день и час до этой даты
    // включительно (в поясе группы). null — встреча разовая.
    repeatUntil: date("repeat_until"),
    // Начало повтора, о котором уже напомнили. Одного флага reminder_sent
    // повторяющейся встрече мало: напоминать нужно перед каждым повтором.
    remindedStart: timestamp("reminded_start", { withTimezone: true }),
    // Итоги прошедшей встречи: что решили. Пишет любой приглашённый.
    summary: text("summary").notNull().default(""),
    summaryBy: bigint("summary_by", { mode: "number" }),
    summaryAt: timestamp("summary_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    index("ix_meetings_chat_id").on(table.chatId),
    // Встречи вдвоём ищутся по человеку: «я создал» или «меня позвали».
    index("ix_meetings_with_user").on(table.withUser).where(sql`"with_user" is not null`),
    index("ix_meetings_pair_initiator").on(table.initiatorId).where(sql`"with_user" is not null`),
    check("ck_meetings_pair", sql`("chat_id" is null) = ("with_user" is not null)`),
  ],
).enableRLS();

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
).enableRLS();

/**
 * Был ли человек на встрече. У серии — на каждом повторе отдельно
 * (`occurrence` — день повтора в поясе группы), у разовой — её день.
 * Отвечают в боте после встречи («Был» / «Не был») или на сайте у
 * прошедшей встречи.
 */
export const meetingAttendance = pgTable(
  "meeting_attendance",
  {
    meetingId: integer("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    occurrence: date("occurrence").notNull(),
    userId: bigint("user_id", { mode: "number" }).notNull(),
    attended: boolean("attended").notNull(),
    answeredAt: timestamp("answered_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.meetingId, table.occurrence, table.userId] })],
).enableRLS();

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
}).enableRLS();

/**
 * Консоль владельца (/admin) — второй фактор поверх входа через Telegram.
 *
 * Одноразовый код от бота: в базе только HMAC-SHA256 кода с солью и ключом,
 * которого в базе нет (lib/ownerConsole). У владельца не больше одного живого
 * кода: новый заменяет прежний. attempts — сколько раз его пытались ввести.
 */
export const ownerLoginCodes = pgTable("owner_login_codes", {
  userId: bigint("user_id", { mode: "number" })
    .primaryKey()
    .references(() => users.userId, { onDelete: "cascade" }),
  codeHash: varchar("code_hash", { length: 64 }).notNull(),
  salt: varchar("salt", { length: 32 }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  createdAt: createdAt(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}).enableRLS();

/**
 * Сессия консоли (кука `qairu_owner`, путь /admin). Как и у web_sessions —
 * только SHA-256 токена. Привязана к человеку и к его сессии сайта
 * (web_token_hash): выход с сайта гасит и консоль. Срок жёсткий, без продления.
 */
export const ownerSessions = pgTable(
  "owner_sessions",
  {
    tokenHash: varchar("token_hash", { length: 64 }).primaryKey(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.userId, { onDelete: "cascade" }),
    webTokenHash: varchar("web_token_hash", { length: 64 }).notNull(),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("ix_owner_sessions_user_id").on(table.userId)],
).enableRLS();

/**
 * Журнал консоли: код выслан, вход, неверный код, выход — и какие карточки
 * людей и групп владелец открывал. Адрес и браузер — только ключевым хешем
 * (сырые не хранятся), плюс грубая метка «Chrome · Windows», чтобы владелец
 * узнал своё устройство.
 */
export const ownerAudit = pgTable(
  "owner_audit",
  {
    id: serial("id").primaryKey(),
    userId: bigint("user_id", { mode: "number" }).notNull(),
    // code_sent | send_failed | login | wrong | expired | locked | throttled | logout | logout_all
    // | user_view | group_view
    event: varchar("event", { length: 16 }).notNull(),
    // Чью карточку открыли: id человека (user_view) или группы (group_view). У входов — NULL.
    targetId: bigint("target_id", { mode: "number" }),
    ok: boolean("ok").notNull(),
    ipHash: varchar("ip_hash", { length: 64 }).notNull().default(""),
    uaHash: varchar("ua_hash", { length: 64 }).notNull().default(""),
    device: varchar("device", { length: 48 }).notNull().default(""),
    createdAt: createdAt(),
  },
  (table) => [index("ix_owner_audit_created_at").on(table.createdAt)],
).enableRLS();

/**
 * Заявки в друзья. Живая (pending) — одна на пару людей в любую сторону:
 * это держит уникальный индекс по паре. Ответ не удаляет строку, а меняет
 * статус: по отказу (declined, decided_at) считается пауза перед новой
 * заявкой, по строкам — счётчики консоли. Добавление по личной ссылке
 * пишется сразу принятой заявкой (via = link).
 */
export const friendRequests = pgTable(
  "friend_requests",
  {
    id: serial("id").primaryKey(),
    fromUser: bigint("from_user", { mode: "number" })
      .notNull()
      .references(() => users.userId, { onDelete: "cascade" }),
    toUser: bigint("to_user", { mode: "number" })
      .notNull()
      .references(() => users.userId, { onDelete: "cascade" }),
    status: varchar("status", { length: 16 }).notNull().default("pending"), // pending | accepted | declined | cancelled
    via: varchar("via", { length: 8 }).notNull().default("search"), // search | group | link
    createdAt: createdAt(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (table) => [
    index("ix_friend_requests_to").on(table.toUser, table.status),
    index("ix_friend_requests_from").on(table.fromUser, table.status),
    uniqueIndex("ux_friend_requests_pending")
      .on(sql`least("from_user", "to_user")`, sql`greatest("from_user", "to_user")`)
      .where(sql`"status" = 'pending'`),
  ],
).enableRLS();

/** Дружба взаимна: одна строка на пару, меньший id — в user_a. */
export const friendships = pgTable(
  "friendships",
  {
    userA: bigint("user_a", { mode: "number" })
      .notNull()
      .references(() => users.userId, { onDelete: "cascade" }),
    userB: bigint("user_b", { mode: "number" })
      .notNull()
      .references(() => users.userId, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.userA, table.userB] }),
    index("ix_friendships_user_b").on(table.userB),
    check("ck_friendships_order", sql`"user_a" < "user_b"`),
  ],
).enableRLS();

/**
 * Блокировка. Заблокированный не пришлёт ни заявку, ни приглашение и не
 * увидит групп того, кто его заблокировал; дружба при блокировке рвётся.
 * Сам он об этом не узнаёт.
 */
export const userBlocks = pgTable(
  "user_blocks",
  {
    blocker: bigint("blocker", { mode: "number" })
      .notNull()
      .references(() => users.userId, { onDelete: "cascade" }),
    blocked: bigint("blocked", { mode: "number" })
      .notNull()
      .references(() => users.userId, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.blocker, table.blocked] }), index("ix_user_blocks_blocked").on(table.blocked)],
).enableRLS();

/**
 * Личная ссылка «добавь меня в друзья» (/f/<код>, QR, startapp=f_<код>).
 * Кто её открыл и нажал «Добавить», сразу становится другом — человек сам
 * ею поделился. Код можно сменить: старая ссылка перестаёт работать.
 */
export const friendLinks = pgTable("friend_links", {
  userId: bigint("user_id", { mode: "number" })
    .primaryKey()
    .references(() => users.userId, { onDelete: "cascade" }),
  code: varchar("code", { length: 16 }).notNull().unique(),
  createdAt: createdAt(),
}).enableRLS();

/**
 * Приглашения в группы между друзьями.
 *   invite — участник (from_user) зовёт друга (to_user); друг принимает сам;
 *   ask    — друг (from_user) просится в группу участника (to_user);
 *            участник одним нажатием принимает его.
 * Без согласия второй стороны в группу никто не попадает. Срок — expires_at;
 * при ответе всё проверяется заново (lib/friends).
 */
export const groupInvites = pgTable(
  "group_invites",
  {
    id: serial("id").primaryKey(),
    chatId: bigint("chat_id", { mode: "number" })
      .notNull()
      .references(() => chats.chatId, { onDelete: "cascade" }),
    fromUser: bigint("from_user", { mode: "number" })
      .notNull()
      .references(() => users.userId, { onDelete: "cascade" }),
    toUser: bigint("to_user", { mode: "number" })
      .notNull()
      .references(() => users.userId, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 8 }).notNull().default("invite"), // invite | ask
    status: varchar("status", { length: 16 }).notNull().default("pending"), // pending | accepted | declined | cancelled
    createdAt: createdAt(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("ix_group_invites_to").on(table.toUser, table.status),
    index("ix_group_invites_from").on(table.fromUser, table.status),
    index("ix_group_invites_chat").on(table.chatId),
    uniqueIndex("ux_group_invites_pending")
      .on(table.chatId, table.kind, table.fromUser, table.toUser)
      .where(sql`"status" = 'pending'`),
  ],
).enableRLS();

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
export type FriendRequest = typeof friendRequests.$inferSelect;
export type GroupInvite = typeof groupInvites.$inferSelect;
export type Notice = typeof notices.$inferSelect;

/** Как показывать человека в списках: имя, иначе @username, иначе id. */
/**
 * Как человека подписывать в группе. Сперва имя, которое он сам указал при
 * вступлении («Как тебя подписать?») — одногруппники и староста узнают его
 * по нему, а не по нику, — потом имя из Telegram.
 */
export function displayName(
  user: Pick<User, "fullName" | "username" | "userId"> & { realName?: string | null },
): string {
  return user.realName || user.fullName || (user.username ? `@${user.username}` : String(user.userId));
}

/** Как человек записан в Telegram — вторая строка там, где главное имя его собственное. */
export function telegramName(user: Pick<User, "fullName" | "username">): string | null {
  return user.username ? `@${user.username}` : user.fullName || null;
}
