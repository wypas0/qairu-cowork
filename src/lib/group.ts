/**
 * Состояние группы для сайта: тепловая карта, окна, участники, встречи.
 *
 * Один и тот же расчёт обслуживает и серверный рендер страницы, и JSON для
 * перерисовки сетки при движении ползунка кворума — иначе две ветки быстро
 * разъехались бы.
 */

import "server-only";

import {
  type AvailabilityResult,
  type HeatDay,
  type ParityOf,
  computeAvailability,
  heatmap,
  parityFromSemesterStart,
} from "@/core/availability";
import { slotTimes } from "@/core/grid";
import { fmtInterval } from "@/core/intervals";
import { type DateStr, chatTz, todayIn } from "@/core/timeutils";
import * as repo from "@/db/repo";
import type { Chat, Meeting, MeetingResponse, User } from "@/db/schema";
import { displayName } from "@/db/schema";
import { formatDay } from "@/i18n";
import { DAYS_AHEAD, SLOT_STEP } from "./config";

export function parityOfChat(chat: Chat): ParityOf | null {
  return chat.semesterStart ? parityFromSemesterStart(chat.semesterStart) : null;
}

export type GroupState = {
  members: User[];
  names: Map<number, string>;
  filledIds: Set<number>;
  missing: User[];
  grid: HeatDay[];
  result: AvailabilityResult;
  total: number;
  today: DateStr;
  slotTimes: number[];
  meetings: Meeting[];
  responses: Map<number, MeetingResponse[]>;
  minSlot: number;
};

export async function loadGroupState(
  chat: Chat,
  options: { quorum?: number | null; minSlot?: number | null; withMeetings?: boolean } = {},
): Promise<GroupState> {
  const { quorum = null, minSlot = null, withMeetings = true } = options;

  const members = await repo.chatMembers(chat.chatId);
  const people = await repo.buildPersonSchedules(members);
  const meetingRows = withMeetings ? await repo.chatMeetings(chat.chatId, 10) : [];
  const responses = await repo.meetingResponsesForMany(meetingRows.map((row) => row.id));

  const filledIds = new Set(people.filter((person) => person.hasData).map((p) => p.userId));
  const names = new Map(members.map((member) => [member.userId, displayName(member)]));
  const today = todayIn(chatTz(chat));
  const parityOf = parityOfChat(chat);
  const minimum = minSlot ?? chat.minSlotMin;

  const grid = heatmap(people, today, {
    daysAhead: DAYS_AHEAD,
    dayStart: chat.dayStartMin,
    dayEnd: chat.dayEndMin,
    step: SLOT_STEP,
    parityOf,
    bufferMin: chat.travelBufferMin,
  });

  const result = computeAvailability(people, today, {
    daysAhead: DAYS_AHEAD,
    dayStart: chat.dayStartMin,
    dayEnd: chat.dayEndMin,
    minSlot: minimum,
    quorum,
    parityOf,
    bufferMin: chat.travelBufferMin,
  });

  return {
    members,
    names,
    filledIds,
    missing: members.filter((member) => !filledIds.has(member.userId)),
    grid,
    result,
    total: result.participants.length,
    today,
    slotTimes: slotTimes(chat.dayStartMin, chat.dayEndMin, SLOT_STEP),
    meetings: meetingRows,
    responses,
    minSlot: minimum,
  };
}

/** Сериализуемая порция данных для клиентской доски. */
export type BoardPayload = {
  total: number;
  quorum: number;
  everyone: boolean;
  days: {
    date: string;
    label: string;
    cells: { start: number; end: number; count: number }[];
  }[];
  windows: {
    date: string;
    label: string;
    items: {
      start: number;
      end: number;
      text: string;
      count: number;
      missing: string[];
    }[];
  }[];
  missing: string[];
};

export function toBoardPayload(state: GroupState, lang: string): BoardPayload {
  return {
    total: state.total,
    quorum: state.result.quorum,
    everyone: state.result.everyone,
    days: state.grid.map((day) => ({
      date: day.day,
      label: formatDay(lang, day.day),
      cells: day.cells.map((cell) => ({
        start: cell.startMin,
        end: cell.endMin,
        count: cell.freeIds.length,
      })),
    })),
    windows: state.result.days
      .filter((day) => day.windows.length > 0)
      .map((day) => ({
        date: day.day,
        label: formatDay(lang, day.day),
        items: day.windows.map((window) => ({
          start: window.interval[0],
          end: window.interval[1],
          text: fmtInterval(window.interval),
          count: window.freeIds.length,
          missing: state.result.participants
            .filter((person) => !window.freeIds.includes(person.userId))
            .map((person) => state.names.get(person.userId) ?? "?"),
        })),
      })),
    missing: state.missing.map((member) => displayName(member)),
  };
}
