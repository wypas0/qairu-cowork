/**
 * Слой доступа к данным. Все запросы к БД живут здесь.
 *
 * Каждая функция принимает необязательный исполнитель `exec`: без него берётся
 * общее соединение, с ним — транзакция. Так вызывающий код может собрать
 * несколько записей в одну атомарную операцию, не протаскивая соединение
 * через все слои.
 */

import "server-only";

import crypto from "node:crypto";
import { and, desc, eq, gt, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";

import { PersonSchedule } from "@/core/availability";
import type { Interval } from "@/core/intervals";
import type { DateStr } from "@/core/timeutils";
import { type Db, getDb } from "./client";
import {
  type BusySlot,
  type Chat,
  type Meeting,
  type MeetingResponse,
  type Notice,
  type User,
  ROLE_ADMIN,
  ROLE_MEMBER,
  botState,
  busySlots,
  chats,
  credentials,
  displayName,
  meetingResponses,
  meetings,
  memberships,
  notices,
  scheduleState,
  users,
  webSessions,
} from "./schema";

type TxCallback = Parameters<Db["transaction"]>[0];
export type Exec = Db | Parameters<TxCallback>[0];

function ex(exec?: Exec): Exec {
  return exec ?? getDb();
}

export async function transaction<T>(fn: (tx: Exec) => Promise<T>): Promise<T> {
  return getDb().transaction((tx) => fn(tx));
}

// --------------------------------------------------------------------------
// Пользователи и чаты
// --------------------------------------------------------------------------

/** Создать или обновить пользователя. Username обновляем всегда — он меняется. */
export async function upsertUser(
  args: { userId: number; username?: string | null; fullName?: string; lang?: string | null },
  exec?: Exec,
): Promise<User> {
  const set: Record<string, unknown> = { username: args.username ?? null };
  if (args.fullName) set.fullName = args.fullName;
  if (args.lang) set.lang = args.lang;

  const [row] = await ex(exec)
    .insert(users)
    .values({
      userId: args.userId,
      username: args.username ?? null,
      fullName: args.fullName ?? "",
      lang: args.lang ?? "ru",
    })
    .onConflictDoUpdate({ target: users.userId, set })
    .returning();
  return row;
}

export async function getUser(userId: number, exec?: Exec): Promise<User | null> {
  const [row] = await ex(exec).select().from(users).where(eq(users.userId, userId)).limit(1);
  return row ?? null;
}

export async function setUserLang(userId: number, lang: string, exec?: Exec): Promise<void> {
  await ex(exec).update(users).set({ lang }).where(eq(users.userId, userId));
}

export async function renameUser(userId: number, fullName: string, exec?: Exec): Promise<void> {
  const clean = fullName.trim();
  if (!clean) return;
  await ex(exec)
    .update(users)
    .set({ fullName: clean.slice(0, 120) })
    .where(eq(users.userId, userId));
}

export async function upsertChat(chatId: number, title: string, exec?: Exec): Promise<Chat> {
  const set: Record<string, unknown> = {};
  if (title) set.title = title.slice(0, 256);

  const [row] = await ex(exec)
    .insert(chats)
    .values({ chatId, title: title.slice(0, 256) })
    .onConflictDoUpdate({
      target: chats.chatId,
      // Пустой set в ON CONFLICT недопустим — тогда просто переписываем chat_id собой.
      set: Object.keys(set).length ? set : { chatId: sql`${chats.chatId}` },
    })
    .returning();
  return row;
}

export async function getChat(chatId: number, exec?: Exec): Promise<Chat | null> {
  const [row] = await ex(exec).select().from(chats).where(eq(chats.chatId, chatId)).limit(1);
  return row ?? null;
}

export async function getChatBySlug(slug: string, exec?: Exec): Promise<Chat | null> {
  const [row] = await ex(exec).select().from(chats).where(eq(chats.slug, slug)).limit(1);
  return row ?? null;
}

export async function updateChat(
  chatId: number,
  patch: Partial<typeof chats.$inferInsert>,
  exec?: Exec,
): Promise<void> {
  await ex(exec).update(chats).set(patch).where(eq(chats.chatId, chatId));
}

/** true, если участник добавлен впервые. Роль уже состоящего участника не меняется. */
export async function addMembership(
  chatId: number,
  userId: number,
  exec?: Exec,
  role: string = ROLE_MEMBER,
): Promise<boolean> {
  const inserted = await ex(exec)
    .insert(memberships)
    .values({ chatId, userId, role })
    .onConflictDoNothing()
    .returning({ chatId: memberships.chatId });
  return inserted.length > 0;
}

export type RosterEntry = { user: User; role: string; joinedAt: Date };

/** Участники вместе с ролью: администраторы первыми, дальше по имени. */
export async function chatRoster(chatId: number, exec?: Exec): Promise<RosterEntry[]> {
  const rows = await ex(exec)
    .select({ user: users, role: memberships.role, joinedAt: memberships.joinedAt })
    .from(users)
    .innerJoin(memberships, eq(memberships.userId, users.userId))
    .where(eq(memberships.chatId, chatId))
    .orderBy(users.fullName);
  return rows.sort((a, b) => Number(b.role === ROLE_ADMIN) - Number(a.role === ROLE_ADMIN));
}

export async function memberRole(
  chatId: number,
  userId: number,
  exec?: Exec,
): Promise<string | null> {
  const [row] = await ex(exec)
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.chatId, chatId), eq(memberships.userId, userId)))
    .limit(1);
  return row?.role ?? null;
}

/** Сменить роль. false — человек не состоит в группе. */
export async function setMemberRole(
  chatId: number,
  userId: number,
  role: string,
  exec?: Exec,
): Promise<boolean> {
  const updated = await ex(exec)
    .update(memberships)
    .set({ role: role === ROLE_ADMIN ? ROLE_ADMIN : ROLE_MEMBER })
    .where(and(eq(memberships.chatId, chatId), eq(memberships.userId, userId)))
    .returning({ userId: memberships.userId });
  return updated.length > 0;
}

export async function adminIds(chatId: number, exec?: Exec): Promise<number[]> {
  const rows = await ex(exec)
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.chatId, chatId), eq(memberships.role, ROLE_ADMIN)));
  return rows.map((row) => row.userId);
}

export async function removeMembership(
  chatId: number,
  userId: number,
  exec?: Exec,
): Promise<void> {
  await ex(exec)
    .delete(memberships)
    .where(and(eq(memberships.chatId, chatId), eq(memberships.userId, userId)));
}

export async function isMember(chatId: number, userId: number, exec?: Exec): Promise<boolean> {
  const [row] = await ex(exec)
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.chatId, chatId), eq(memberships.userId, userId)))
    .limit(1);
  return Boolean(row);
}

export async function chatMembers(chatId: number, exec?: Exec): Promise<User[]> {
  return ex(exec)
    .select({
      userId: users.userId,
      username: users.username,
      fullName: users.fullName,
      lang: users.lang,
      isWeb: users.isWeb,
      createdAt: users.createdAt,
    })
    .from(users)
    .innerJoin(memberships, eq(memberships.userId, users.userId))
    .where(eq(memberships.chatId, chatId))
    .orderBy(users.fullName);
}

export async function userChats(userId: number, exec?: Exec): Promise<Chat[]> {
  return ex(exec)
    .select({
      chatId: chats.chatId,
      slug: chats.slug,
      origin: chats.origin,
      title: chats.title,
      lang: chats.lang,
      tz: chats.tz,
      dayStartMin: chats.dayStartMin,
      dayEndMin: chats.dayEndMin,
      minSlotMin: chats.minSlotMin,
      travelBufferMin: chats.travelBufferMin,
      semesterStart: chats.semesterStart,
      reminderMin: chats.reminderMin,
      createdBy: chats.createdBy,
      createdAt: chats.createdAt,
    })
    .from(chats)
    .innerJoin(memberships, eq(memberships.chatId, chats.chatId))
    .where(eq(memberships.userId, userId));
}

export async function findUserByUsername(username: string, exec?: Exec): Promise<User | null> {
  const clean = username.replace(/^@+/, "").toLowerCase();
  if (!clean) return null;
  const [row] = await ex(exec)
    .select()
    .from(users)
    .where(sql`lower(${users.username}) = ${clean}`)
    .limit(1);
  return row ?? null;
}

export async function usersByIds(ids: number[], exec?: Exec): Promise<Map<number, User>> {
  if (ids.length === 0) return new Map();
  const rows = await ex(exec).select().from(users).where(inArray(users.userId, ids));
  return new Map(rows.map((row) => [row.userId, row]));
}

// --------------------------------------------------------------------------
// Расписание
// --------------------------------------------------------------------------

export type WeeklySlotInput = {
  weekday: number;
  start: number;
  end: number;
  label?: string;
  parity?: number | null;
  kind?: string;
};

/**
 * Заменить недельные слоты для перечисленных дней.
 *
 * Удаляются все повторяющиеся слоты этих дней — обеих чётностей.
 */
export async function replaceWeeklySlots(
  userId: number,
  weekdays: number[],
  slots: WeeklySlotInput[],
  source = "import",
  exec?: Exec,
): Promise<void> {
  const db = ex(exec);
  if (weekdays.length) {
    await db
      .delete(busySlots)
      .where(
        and(
          eq(busySlots.userId, userId),
          inArray(busySlots.weekday, weekdays),
          isNull(busySlots.specificDate),
          isNull(busySlots.dateFrom),
        ),
      );
  }
  if (slots.length) {
    await db.insert(busySlots).values(
      slots.map((slot) => ({
        userId,
        weekday: slot.weekday,
        startMin: slot.start,
        endMin: slot.end,
        label: (slot.label ?? "").slice(0, 64),
        weekParity: slot.parity ?? null,
        kind: (slot.kind ?? "class").slice(0, 16),
        source: source.slice(0, 16),
      })),
    );
  }
  await markFilled(userId, true, db);
}

export async function clearSchedule(userId: number, exec?: Exec): Promise<void> {
  const db = ex(exec);
  await db.delete(busySlots).where(eq(busySlots.userId, userId));
  await markFilled(userId, false, db);
}

/** Разовая занятость на конкретную дату. */
export async function addDatedSlot(
  args: {
    userId: number;
    day: DateStr;
    start: number;
    end: number;
    label?: string;
    kind?: string;
  },
  exec?: Exec,
): Promise<void> {
  const db = ex(exec);
  await db.insert(busySlots).values({
    userId: args.userId,
    specificDate: args.day,
    startMin: args.start,
    endMin: args.end,
    label: (args.label ?? "").slice(0, 64),
    kind: (args.kind ?? "other").slice(0, 16),
    source: "wizard",
  });
  await markFilled(args.userId, true, db);
}

/** Занятость на диапазон дат: сессия, поездка, «занят до пятницы». */
export async function addRangeSlot(
  args: {
    userId: number;
    dateFrom: DateStr;
    dateTo: DateStr;
    start: number;
    end: number;
    label?: string;
    kind?: string;
  },
  exec?: Exec,
): Promise<void> {
  const db = ex(exec);
  await db.insert(busySlots).values({
    userId: args.userId,
    dateFrom: args.dateFrom,
    dateTo: args.dateTo,
    startMin: args.start,
    endMin: args.end,
    label: (args.label ?? "").slice(0, 64),
    kind: (args.kind ?? "exam").slice(0, 16),
    source: "wizard",
  });
  await markFilled(args.userId, true, db);
}

/** Удалить одну занятость. Чужую удалить нельзя: false. */
export async function deleteSlot(userId: number, slotId: number, exec?: Exec): Promise<boolean> {
  const removed = await ex(exec)
    .delete(busySlots)
    .where(and(eq(busySlots.id, slotId), eq(busySlots.userId, userId)))
    .returning({ id: busySlots.id });
  return removed.length > 0;
}

/** Разовые занятости и периоды, по возрастанию даты. */
export async function datedSlots(userId: number, exec?: Exec): Promise<BusySlot[]> {
  const rows = await ex(exec)
    .select()
    .from(busySlots)
    .where(
      and(
        eq(busySlots.userId, userId),
        or(isNotNull(busySlots.specificDate), isNotNull(busySlots.dateFrom)),
      ),
    );
  const dayOf = (slot: BusySlot) => slot.specificDate ?? slot.dateFrom ?? "";
  return rows.sort((a, b) => dayOf(a).localeCompare(dayOf(b)) || a.startMin - b.startMin);
}

/** Удалить все разовые занятости и диапазоны, оставив недельное расписание. */
export async function deleteDatedSlots(userId: number, exec?: Exec): Promise<number> {
  const removed = await ex(exec)
    .delete(busySlots)
    .where(
      and(
        eq(busySlots.userId, userId),
        or(isNotNull(busySlots.specificDate), isNotNull(busySlots.dateFrom)),
      ),
    )
    .returning({ id: busySlots.id });
  return removed.length;
}

export async function getSlots(userId: number, exec?: Exec): Promise<BusySlot[]> {
  return ex(exec)
    .select()
    .from(busySlots)
    .where(eq(busySlots.userId, userId))
    .orderBy(busySlots.weekday, busySlots.specificDate, busySlots.startMin);
}

export async function markFilled(userId: number, filled: boolean, exec?: Exec): Promise<void> {
  const db = ex(exec);
  await db
    .insert(scheduleState)
    .values({ userId, filled, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: scheduleState.userId,
      set: { filled, updatedAt: new Date() },
    });
  // Любой способ заполнить расписание — сайт, бот, мастер, /busy — выполняет
  // просьбу администратора, поэтому её баннер гаснет здесь, в одном месте.
  if (filled) await markFillNoticesRead(userId, db);
}

export async function isFilled(userId: number, exec?: Exec): Promise<boolean> {
  const [row] = await ex(exec)
    .select({ filled: scheduleState.filled })
    .from(scheduleState)
    .where(eq(scheduleState.userId, userId))
    .limit(1);
  return Boolean(row?.filled);
}

export async function filledIds(ids: number[], exec?: Exec): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  const rows = await ex(exec)
    .select({ userId: scheduleState.userId, filled: scheduleState.filled })
    .from(scheduleState)
    .where(inArray(scheduleState.userId, ids));
  return new Set(rows.filter((row) => row.filled).map((row) => row.userId));
}

/** Собрать доменные объекты PersonSchedule для движка availability. */
export async function buildPersonSchedules(
  people: readonly User[],
  exec?: Exec,
): Promise<PersonSchedule[]> {
  if (people.length === 0) return [];
  const db = ex(exec);
  const ids = people.map((person) => person.userId);

  const slots = await db.select().from(busySlots).where(inArray(busySlots.userId, ids));
  const filled = await filledIds(ids, db);

  const byUser = new Map<number, PersonSchedule>();
  for (const person of people) {
    byUser.set(
      person.userId,
      new PersonSchedule({
        userId: person.userId,
        name: displayName(person),
        hasData: filled.has(person.userId),
      }),
    );
  }

  for (const slot of slots) {
    const person = byUser.get(slot.userId);
    if (!person) continue;
    const interval: Interval = [slot.startMin, slot.endMin];
    if (slot.specificDate !== null) {
      const list = person.dated.get(slot.specificDate) ?? [];
      list.push(interval);
      person.dated.set(slot.specificDate, list);
    } else if (slot.dateFrom !== null && slot.dateTo !== null) {
      person.ranges.push({
        dateFrom: slot.dateFrom,
        dateTo: slot.dateTo,
        start: slot.startMin,
        end: slot.endMin,
      });
    } else if (slot.weekday !== null) {
      if (slot.weekParity === null) {
        const list = person.weekly.get(slot.weekday) ?? [];
        list.push(interval);
        person.weekly.set(slot.weekday, list);
      } else {
        const byParity = person.weeklyParity.get(slot.weekParity) ?? new Map<number, Interval[]>();
        const list = byParity.get(slot.weekday) ?? [];
        list.push(interval);
        byParity.set(slot.weekday, list);
        person.weeklyParity.set(slot.weekParity, byParity);
      }
    }
  }

  return people.map((person) => byUser.get(person.userId)!);
}

// --------------------------------------------------------------------------
// Встречи
// --------------------------------------------------------------------------

export async function createMeeting(
  args: {
    chatId: number;
    initiatorId: number;
    place: string;
    whenText: string;
    goal: string;
    invitees: number[];
    whenStart?: Date | null;
  },
  exec?: Exec,
): Promise<Meeting> {
  const [row] = await ex(exec)
    .insert(meetings)
    .values({
      chatId: args.chatId,
      initiatorId: args.initiatorId,
      place: args.place.slice(0, 256),
      whenText: args.whenText.slice(0, 256),
      goal: args.goal,
      invitees: args.invitees.join(","),
      whenStart: args.whenStart ?? null,
    })
    .returning();
  return row;
}

export function inviteeIds(meeting: Pick<Meeting, "invitees">): number[] {
  return meeting.invitees
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map(Number)
    .filter((value) => Number.isFinite(value));
}

export async function getMeeting(meetingId: number, exec?: Exec): Promise<Meeting | null> {
  const [row] = await ex(exec).select().from(meetings).where(eq(meetings.id, meetingId)).limit(1);
  return row ?? null;
}

export async function updateMeeting(
  meetingId: number,
  patch: Partial<typeof meetings.$inferInsert>,
  exec?: Exec,
): Promise<void> {
  await ex(exec).update(meetings).set(patch).where(eq(meetings.id, meetingId));
}

export async function setResponse(
  args: { meetingId: number; userId: number; answer: string; comment?: string },
  exec?: Exec,
): Promise<void> {
  const set: Record<string, unknown> = { answer: args.answer, respondedAt: new Date() };
  if (args.comment) set.comment = args.comment;

  await ex(exec)
    .insert(meetingResponses)
    .values({
      meetingId: args.meetingId,
      userId: args.userId,
      answer: args.answer,
      comment: args.comment ?? "",
    })
    .onConflictDoUpdate({
      target: [meetingResponses.meetingId, meetingResponses.userId],
      set,
    });
}

export async function meetingResponsesFor(
  meetingId: number,
  exec?: Exec,
): Promise<MeetingResponse[]> {
  return ex(exec)
    .select()
    .from(meetingResponses)
    .where(eq(meetingResponses.meetingId, meetingId));
}

export async function meetingResponsesForMany(
  meetingIds: number[],
  exec?: Exec,
): Promise<Map<number, MeetingResponse[]>> {
  const result = new Map<number, MeetingResponse[]>();
  if (meetingIds.length === 0) return result;
  const rows = await ex(exec)
    .select()
    .from(meetingResponses)
    .where(inArray(meetingResponses.meetingId, meetingIds));
  for (const id of meetingIds) result.set(id, []);
  for (const row of rows) result.get(row.meetingId)?.push(row);
  return result;
}

export async function chatMeetings(chatId: number, limit = 20, exec?: Exec): Promise<Meeting[]> {
  return ex(exec)
    .select()
    .from(meetings)
    .where(eq(meetings.chatId, chatId))
    .orderBy(desc(meetings.createdAt))
    .limit(limit);
}

/** Открытые встречи во всех группах пользователя — для профильной панели. */
export async function userMeetings(
  userId: number,
  limit = 20,
  exec?: Exec,
): Promise<{ meeting: Meeting; chat: Chat }[]> {
  return ex(exec)
    .select({ meeting: meetings, chat: chats })
    .from(meetings)
    .innerJoin(chats, eq(chats.chatId, meetings.chatId))
    .innerJoin(memberships, eq(memberships.chatId, chats.chatId))
    .where(and(eq(memberships.userId, userId), eq(meetings.status, "open")))
    .orderBy(desc(meetings.createdAt))
    .limit(limit);
}

/**
 * Открытые встречи, которым пора отправить напоминание.
 *
 * Порог «за N минут» живёт у чата, поэтому условие считается прямо в SQL:
 * встреча ещё не наступила, но до неё осталось не больше `reminder_min`.
 */
export async function meetingsDueForReminder(
  now: Date,
  exec?: Exec,
): Promise<{ meeting: Meeting; chat: Chat }[]> {
  return ex(exec)
    .select({ meeting: meetings, chat: chats })
    .from(meetings)
    .innerJoin(chats, eq(chats.chatId, meetings.chatId))
    .where(
      and(
        eq(meetings.status, "open"),
        eq(meetings.reminderSent, false),
        isNotNull(meetings.whenStart),
        sql`${chats.reminderMin} > 0`,
        gt(meetings.whenStart, now),
        // Внутри sql-фрагмента момент передаётся строкой с явным приведением:
        // «голый» Date здесь — параметр без типа, и драйвер postgres.js на нём падает.
        sql`${meetings.whenStart} <= ${now.toISOString()}::timestamptz
            + make_interval(mins => ${chats.reminderMin})`,
      ),
    );
}

// --------------------------------------------------------------------------
// Веб-версия: слаги групп, синтетические пользователи, сессии-ссылки
// --------------------------------------------------------------------------

const SLUG_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
// Синтетические id для сущностей, созданных на сайте. Telegram выдаёт
// положительные id пользователям и id вида -100… чатам, поэтому диапазон
// ниже -10^15 гарантированно свободен.
const SYNTHETIC_BASE = -(10 ** 15);

export function newSlug(length = 8): string {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) out += SLUG_ALPHABET[bytes[i] % SLUG_ALPHABET.length];
  return out;
}

export function newWebId(): number {
  // 40 случайных бит: результат остаётся далеко внутри Number.MAX_SAFE_INTEGER.
  const bytes = crypto.randomBytes(5);
  let value = 0;
  for (const byte of bytes) value = value * 256 + byte;
  return SYNTHETIC_BASE - value;
}

export function newToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/** Выдать группе публичный слаг, если его ещё нет. */
export async function ensureSlug(chat: Chat, exec?: Exec): Promise<string> {
  if (chat.slug) return chat.slug;
  const db = ex(exec);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = newSlug();
    const [taken] = await db
      .select({ slug: chats.slug })
      .from(chats)
      .where(eq(chats.slug, candidate))
      .limit(1);
    if (!taken) {
      await db.update(chats).set({ slug: candidate }).where(eq(chats.chatId, chat.chatId));
      return candidate;
    }
  }
  throw new Error("Не удалось подобрать свободный слаг");
}

/** Группа, созданная на сайте, без Telegram-чата. */
export async function createWebChat(
  args: { title: string; tz?: string; lang?: string },
  exec?: Exec,
): Promise<Chat> {
  const db = ex(exec);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const slug = newSlug();
    const [taken] = await db
      .select({ slug: chats.slug })
      .from(chats)
      .where(eq(chats.slug, slug))
      .limit(1);
    if (taken) continue;
    const [row] = await db
      .insert(chats)
      .values({
        chatId: newWebId(),
        slug,
        title: args.title.slice(0, 200) || "Группа",
        origin: "web",
        tz: args.tz ?? "Asia/Almaty",
        lang: args.lang ?? "ru",
      })
      .returning();
    return row;
  }
  throw new Error("Не удалось подобрать свободный слаг");
}

export async function createWebUser(
  args: { fullName: string; lang?: string },
  exec?: Exec,
): Promise<User> {
  const [row] = await ex(exec)
    .insert(users)
    .values({
      userId: newWebId(),
      username: null,
      fullName: args.fullName.slice(0, 120) || "Аноним",
      lang: args.lang ?? "ru",
      isWeb: true,
    })
    .returning();
  return row;
}

export async function issueWebSession(userId: number, exec?: Exec): Promise<string> {
  const token = newToken();
  await ex(exec).insert(webSessions).values({ token, userId });
  return token;
}

export async function deleteWebSession(token: string, exec?: Exec): Promise<void> {
  if (!token) return;
  await ex(exec).delete(webSessions).where(eq(webSessions.token, token));
}

export async function userByWebToken(token: string, exec?: Exec): Promise<User | null> {
  if (!token) return null;
  const db = ex(exec);
  const [session] = await db
    .select()
    .from(webSessions)
    .where(eq(webSessions.token, token))
    .limit(1);
  if (!session) return null;
  await db
    .update(webSessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(webSessions.token, token));
  return getUser(session.userId, db);
}

// --------------------------------------------------------------------------
// Вход по логину и паролю
// --------------------------------------------------------------------------

export type CredentialsRow = typeof credentials.$inferSelect;

export async function getCredentials(userId: number, exec?: Exec): Promise<CredentialsRow | null> {
  const [row] = await ex(exec)
    .select()
    .from(credentials)
    .where(eq(credentials.userId, userId))
    .limit(1);
  return row ?? null;
}

/**
 * Занят ли логин кем-то, кроме `exceptUserId`.
 *
 * Логин не должен совпадать ни с чужим логином, ни с чужим подтверждённым
 * @username из Telegram — иначе ввод «amir» на странице входа стал бы
 * двусмысленным.
 */
export async function loginTaken(login: string, exceptUserId: number, exec?: Exec): Promise<boolean> {
  const db = ex(exec);
  const [byLogin] = await db
    .select({ userId: credentials.userId })
    .from(credentials)
    .where(eq(credentials.login, login))
    .limit(1);
  if (byLogin && byLogin.userId !== exceptUserId) return true;

  const [byUsername] = await db
    .select({ userId: users.userId })
    .from(users)
    .where(and(sql`lower(${users.username}) = ${login}`, eq(users.isWeb, false)))
    .limit(1);
  return Boolean(byUsername && byUsername.userId !== exceptUserId);
}

export async function setCredentials(
  args: { userId: number; login: string; passwordHash: string },
  exec?: Exec,
): Promise<void> {
  await ex(exec)
    .insert(credentials)
    .values({ userId: args.userId, login: args.login, passwordHash: args.passwordHash })
    .onConflictDoUpdate({
      target: credentials.userId,
      set: { login: args.login, passwordHash: args.passwordHash, updatedAt: new Date() },
    });
}

export async function deleteCredentials(userId: number, exec?: Exec): Promise<void> {
  await ex(exec).delete(credentials).where(eq(credentials.userId, userId));
}

/** Все сессии человека, кроме текущей: после смены пароля чужие входы обрываются. */
export async function deleteOtherWebSessions(
  userId: number,
  keepToken: string,
  exec?: Exec,
): Promise<void> {
  await ex(exec)
    .delete(webSessions)
    .where(and(eq(webSessions.userId, userId), sql`${webSessions.token} <> ${keepToken}`));
}

/**
 * Найти учётные данные по тому, что человек ввёл в поле «логин».
 *
 * `@name` — только Telegram-ник подтверждённого аккаунта. Без @ сначала ищем
 * логин сайта, затем Telegram-ник: пересечься они не могут (см. loginTaken).
 */
export async function credentialsForLogin(
  input: string,
  exec?: Exec,
): Promise<{ user: User; credentials: CredentialsRow } | null> {
  const raw = input.trim();
  const clean = raw.replace(/^@+/, "").toLowerCase();
  if (!clean) return null;
  const db = ex(exec);

  if (!raw.startsWith("@")) {
    const [row] = await db
      .select({ user: users, credentials })
      .from(credentials)
      .innerJoin(users, eq(users.userId, credentials.userId))
      .where(eq(credentials.login, clean))
      .limit(1);
    if (row) return row;
  }

  const [row] = await db
    .select({ user: users, credentials })
    .from(credentials)
    .innerJoin(users, eq(users.userId, credentials.userId))
    .where(and(sql`lower(${users.username}) = ${clean}`, eq(users.isWeb, false)))
    .limit(1);
  return row ?? null;
}

// --------------------------------------------------------------------------
// Уведомления на сайте
// --------------------------------------------------------------------------

export async function addNotices(
  rows: {
    chatId: number;
    userId: number;
    kind: string;
    meetingId?: number | null;
    fromUserId?: number | null;
    text?: string;
  }[],
  exec?: Exec,
): Promise<void> {
  if (rows.length === 0) return;
  await ex(exec)
    .insert(notices)
    .values(
      rows.map((row) => ({
        chatId: row.chatId,
        userId: row.userId,
        kind: row.kind.slice(0, 24),
        meetingId: row.meetingId ?? null,
        fromUserId: row.fromUserId ?? null,
        text: (row.text ?? "").slice(0, 500),
      })),
    );
}

export async function unreadNotices(chatId: number, userId: number, exec?: Exec): Promise<Notice[]> {
  return ex(exec)
    .select()
    .from(notices)
    .where(and(eq(notices.chatId, chatId), eq(notices.userId, userId), isNull(notices.readAt)))
    .orderBy(desc(notices.createdAt))
    .limit(20);
}

/** Закрыть уведомление. Чужое закрыть нельзя. */
export async function markNoticeRead(noticeId: number, userId: number, exec?: Exec): Promise<void> {
  await ex(exec)
    .update(notices)
    .set({ readAt: new Date() })
    .where(and(eq(notices.id, noticeId), eq(notices.userId, userId), isNull(notices.readAt)));
}

/** Человек ответил на встречу — баннер «ответь на встречу» больше не нужен. */
export async function markMeetingNoticesRead(
  meetingId: number,
  userId: number,
  exec?: Exec,
): Promise<void> {
  await ex(exec)
    .update(notices)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notices.meetingId, meetingId),
        eq(notices.userId, userId),
        eq(notices.kind, "meeting"),
        isNull(notices.readAt),
      ),
    );
}

/** Встречу отменили — все её баннеры у всех участников больше не актуальны. */
export async function closeMeetingNotices(meetingId: number, exec?: Exec): Promise<void> {
  await ex(exec)
    .update(notices)
    .set({ readAt: new Date() })
    .where(and(eq(notices.meetingId, meetingId), isNull(notices.readAt)));
}

/** Сохранил расписание — напоминания «заполни расписание» во всех группах гаснут. */
export async function markFillNoticesRead(userId: number, exec?: Exec): Promise<void> {
  await ex(exec)
    .update(notices)
    .set({ readAt: new Date() })
    .where(
      and(eq(notices.userId, userId), eq(notices.kind, "fill_schedule"), isNull(notices.readAt)),
    );
}

// --------------------------------------------------------------------------
// Состояние диалогов бота
// --------------------------------------------------------------------------

export async function getBotState<T>(key: string, exec?: Exec): Promise<T | null> {
  const [row] = await ex(exec)
    .select({ data: botState.data })
    .from(botState)
    .where(eq(botState.key, key))
    .limit(1);
  return (row?.data as T) ?? null;
}

export async function setBotState(key: string, data: unknown, exec?: Exec): Promise<void> {
  await ex(exec)
    .insert(botState)
    .values({ key, data: data as object, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: botState.key,
      set: { data: data as object, updatedAt: new Date() },
    });
}

export async function deleteBotState(key: string, exec?: Exec): Promise<void> {
  await ex(exec).delete(botState).where(eq(botState.key, key));
}

/**
 * Счётчик попыток в окне поверх bot_state.
 *
 * Возвращает, сколько попыток уже было в текущем окне, включая эту. Нужен для
 * ограничения перебора паролей и частоты напоминаний — отдельная таблица ради
 * этого не нужна.
 *
 * Увеличение — одна инструкция INSERT … ON CONFLICT DO UPDATE: строка
 * блокируется на время обновления, поэтому параллельные запросы не могут
 * прочитать один и тот же счётчик и затереть прибавки друг друга. Прежняя
 * версия «прочитать → прибавить → записать» пропускала пачку одновременных
 * попыток входа мимо лимита.
 */
export async function bumpCounter(key: string, windowMs: number, exec?: Exec): Promise<number> {
  const now = Date.now();
  const fresh = { count: 1, since: now };
  // Числа уходят в SQL строками с явным приведением: у «голого» параметра
  // внутри sql-фрагмента нет типа, и postgres.js на нём спотыкается.
  const [row] = await ex(exec)
    .insert(botState)
    .values({ key, data: fresh, updatedAt: new Date(now) })
    .onConflictDoUpdate({
      target: botState.key,
      set: {
        data: sql`case
          when coalesce((${botState.data}->>'since')::bigint, 0) < ${String(now - windowMs)}::bigint
            then ${JSON.stringify(fresh)}::jsonb
          else jsonb_set(
            ${botState.data},
            '{count}',
            to_jsonb(coalesce((${botState.data}->>'count')::int, 0) + 1)
          )
        end`,
        updatedAt: new Date(now),
      },
    })
    .returning({ data: botState.data });
  return Number((row?.data as { count?: number } | undefined)?.count ?? 1);
}

export async function peekCounter(key: string, windowMs: number, exec?: Exec): Promise<number> {
  const current = await getBotState<{ count: number; since: number }>(key, exec);
  if (!current || Date.now() - current.since > windowMs) return 0;
  return current.count;
}

export { ROLE_ADMIN, ROLE_MEMBER, displayName };
