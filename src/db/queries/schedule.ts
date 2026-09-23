/** Расписание: недельная занятость, разовая, «неудобно» и сборка PersonSchedule. */

import "server-only";

import { PersonSchedule } from "@/core/availability";
import type { Interval } from "@/core/intervals";
import type { DateStr } from "@/core/timeutils";
import { and, eq, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";
import { type BusySlot, busySlots, displayName, scheduleState, type User } from "../schema";
import { type Exec, ex } from "./base";
import { markFillNoticesRead } from "./notices";

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

/** Вид слота «могу, но не хочу»: время свободно, но неудобно. */
export const SOFT_KIND = "soft";

/**
 * Заменить недельные слоты для перечисленных дней.
 *
 * Удаляются все повторяющиеся слоты этих дней — обеих чётностей. Отметки
 * «неудобно» трогает только редактор сетки (`withSoft`): импорт текстом или
 * с фото приносит одни пары и не должен стирать то, что человек отметил сам.
 */
export async function replaceWeeklySlots(
  userId: number,
  weekdays: number[],
  slots: WeeklySlotInput[],
  source = "import",
  exec?: Exec,
  options: { withSoft?: boolean } = {},
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
          options.withSoft ? undefined : ne(busySlots.kind, SOFT_KIND),
        ),
      );
  }
  if (!options.withSoft) slots = slots.filter((slot) => slot.kind !== SOFT_KIND);
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

/** Когда каждый из людей последний раз сохранял расписание. */
export async function scheduleUpdatedAt(ids: number[], exec?: Exec): Promise<Map<number, Date>> {
  if (ids.length === 0) return new Map();
  const rows = await ex(exec)
    .select({ userId: scheduleState.userId, updatedAt: scheduleState.updatedAt })
    .from(scheduleState)
    .where(and(inArray(scheduleState.userId, ids), eq(scheduleState.filled, true)));
  return new Map(rows.map((row) => [row.userId, row.updatedAt]));
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
    if (slot.kind === SOFT_KIND) {
      // «Неудобно» — не занятость: в расчёт свободных не идёт, только в оценку окон.
      if (slot.weekday !== null) {
        const list = person.softWeekly.get(slot.weekday) ?? [];
        list.push(interval);
        person.softWeekly.set(slot.weekday, list);
      }
      continue;
    }
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
