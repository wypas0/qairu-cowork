/**
 * Состояние группы для сайта: тепловая карта, варианты встречи, участники, встречи.
 *
 * Один и тот же расчёт обслуживает и серверный рендер страницы, и JSON для
 * перерисовки при смене кворума или длительности — иначе две ветки быстро
 * разъехались бы.
 */

import "server-only";

import {
  type DaySlots,
  type HeatDay,
  type ParityOf,
  type PersonSchedule,
  heatmap,
  parityFromSemesterStart,
  slotsOfLength,
} from "@/core/availability";
import { slotTimes } from "@/core/grid";
import { fmtInterval } from "@/core/intervals";
import { type DateStr, addDays, chatTz, formatDM, todayIn, weekdayOf } from "@/core/timeutils";
import * as repo from "@/db/repo";
import type { Chat, Meeting, MeetingResponse, User } from "@/db/schema";
import { displayName } from "@/db/schema";
import { formatDay, weekdayShort } from "@/i18n";
import { DAYS_AHEAD, SLOT_STEP } from "./config";

export function parityOfChat(chat: Chat): ParityOf | null {
  return chat.semesterStart ? parityFromSemesterStart(chat.semesterStart) : null;
}

/** Длительности встречи в выпадающем списке, минуты. */
export const DURATION_OPTIONS = [30, 45, 60, 90, 120, 180];

/** Разумная длительность: целые минуты от 15 до 12 часов, иначе значение по умолчанию. */
export function normalizeDuration(value: number | null | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return fallback;
  return value >= 15 && value <= 12 * 60 ? value : fallback;
}

/** Список длительностей с гарантированно присутствующим текущим значением. */
export function durationOptions(current: number): number[] {
  return [...new Set([...DURATION_OPTIONS, current])].sort((a, b) => a - b);
}

export type GroupState = {
  members: User[];
  names: Map<number, string>;
  filledIds: Set<number>;
  missing: User[];
  grid: HeatDay[];
  slotDays: DaySlots[];
  participants: PersonSchedule[];
  quorum: number;
  everyone: boolean;
  total: number;
  today: DateStr;
  slotTimes: number[];
  meetings: Meeting[];
  responses: Map<number, MeetingResponse[]>;
  duration: number;
};

export async function loadGroupState(
  chat: Chat,
  options: { quorum?: number | null; duration?: number | null; withMeetings?: boolean } = {},
): Promise<GroupState> {
  const { quorum = null, duration = null, withMeetings = true } = options;

  const members = await repo.chatMembers(chat.chatId);
  const people = await repo.buildPersonSchedules(members);
  const meetingRows = withMeetings ? await repo.chatMeetings(chat.chatId, 10) : [];
  const responses = await repo.meetingResponsesForMany(meetingRows.map((row) => row.id));

  const filledIds = new Set(people.filter((person) => person.hasData).map((p) => p.userId));
  const names = new Map(members.map((member) => [member.userId, displayName(member)]));
  const today = todayIn(chatTz(chat));
  const parityOf = parityOfChat(chat);
  const length = normalizeDuration(duration, normalizeDuration(chat.minSlotMin, 60));
  // Тепловая карта — это «эта неделя», а не «7 дней вперёд»: понедельник
  // всегда первым столбцом, даже если сегодня, скажем, четверг. Варианты
  // встречи ниже по-прежнему считаются вперёд от сегодня — предлагать
  // встречу на прошедший день не нужно.
  const weekStart = addDays(today, -weekdayOf(today));

  const grid = heatmap(people, weekStart, {
    daysAhead: DAYS_AHEAD,
    dayStart: chat.dayStartMin,
    dayEnd: chat.dayEndMin,
    step: SLOT_STEP,
    parityOf,
    bufferMin: chat.travelBufferMin,
  });

  const slots = slotsOfLength(people, today, {
    daysAhead: DAYS_AHEAD,
    dayStart: chat.dayStartMin,
    dayEnd: chat.dayEndMin,
    quorum,
    parityOf,
    bufferMin: chat.travelBufferMin,
    duration: length,
    step: SLOT_STEP,
  });

  return {
    members,
    names,
    filledIds,
    missing: members.filter((member) => !filledIds.has(member.userId)),
    grid,
    slotDays: slots.days,
    participants: slots.participants,
    quorum: slots.quorum,
    everyone: slots.everyone,
    total: slots.participants.length,
    today,
    slotTimes: slotTimes(chat.dayStartMin, chat.dayEndMin, SLOT_STEP),
    meetings: meetingRows,
    responses,
    duration: length,
  };
}

export type BoardSlot = {
  start: number;
  end: number;
  text: string;
  count: number;
  missing: string[];
};

/** Сериализуемая порция данных для клиентской доски. */
export type BoardPayload = {
  total: number;
  quorum: number;
  everyone: boolean;
  duration: number;
  days: {
    date: string;
    label: string;
    cells: { start: number; end: number; count: number; missing: string[] }[];
  }[];
  /** Варианты встречи выбранной длины на ближайшие дни, начиная с сегодня. */
  slotDays: {
    date: string;
    label: string;
    short: string;
    items: BoardSlot[];
  }[];
  missing: string[];
};

export function toBoardPayload(state: GroupState, lang: string): BoardPayload {
  const missingNames = (freeIds: readonly number[]) =>
    state.participants
      .filter((person) => !freeIds.includes(person.userId))
      .map((person) => state.names.get(person.userId) ?? "?");

  return {
    total: state.total,
    quorum: state.quorum,
    everyone: state.everyone,
    duration: state.duration,
    days: state.grid.map((day) => ({
      date: day.day,
      label: formatDay(lang, day.day),
      cells: day.cells.map((cell) => ({
        start: cell.startMin,
        end: cell.endMin,
        count: cell.freeIds.length,
        missing: missingNames(cell.freeIds),
      })),
    })),
    slotDays: state.slotDays.map((day) => ({
      date: day.day,
      label: formatDay(lang, day.day),
      short: `${weekdayShort(lang, weekdayOf(day.day))} ${formatDM(day.day)}`,
      items: day.slots.map((slot) => ({
        start: slot.interval[0],
        end: slot.interval[1],
        text: fmtInterval(slot.interval),
        count: slot.freeIds.length,
        missing: missingNames(slot.freeIds),
      })),
    })),
    missing: state.missing.map((member) => displayName(member)),
  };
}
