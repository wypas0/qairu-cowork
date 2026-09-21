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
import { type Period, gridPeriods } from "@/core/grid";
import { occurrencesBetween } from "@/core/recurrence";
import { fmtInterval } from "@/core/intervals";
import {
  type DateStr,
  addDays,
  chatTz,
  formatDM,
  todayIn,
  utcToZonedWall,
  weekdayOf,
  zonedWallToUtc,
} from "@/core/timeutils";
import * as repo from "@/db/repo";
import type { Chat, Meeting, MeetingResponse, User } from "@/db/schema";
import { displayName } from "@/db/schema";
import { formatDay, weekdayShort } from "@/i18n";
import { DAYS_AHEAD, SLOT_STEP } from "./config";

export function parityOfChat(chat: Chat): ParityOf | null {
  return chat.semesterStart ? parityFromSemesterStart(chat.semesterStart) : null;
}

/**
 * С какого момента расписание считается актуальным: начало семестра, если оно
 * уже наступило. Кто сохранял расписание раньше — заполнял его под прошлый
 * семестр, и его пары, скорее всего, уже другие.
 */
export function semesterCutoff(chat: Pick<Chat, "semesterStart" | "tz">): Date | null {
  if (!chat.semesterStart) return null;
  const tz = chatTz(chat as Chat);
  if (chat.semesterStart > todayIn(tz)) return null;
  return zonedWallToUtc(chat.semesterStart as DateStr, 0, tz);
}

/** Расписание сохранено до начала текущего семестра. */
export function isOutdated(updatedAt: Date | undefined, cutoff: Date | null): boolean {
  return Boolean(updatedAt && cutoff && updatedAt < cutoff);
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

/** Насколько далеко вперёд можно листать недели. */
export const MAX_WEEK_AHEAD = 8;

/** Номер показываемой недели: 0 — текущая, 1 — следующая и так далее. */
export function normalizeWeek(value: unknown): number {
  const week = typeof value === "string" ? Number(value) : typeof value === "number" ? value : 0;
  return Number.isInteger(week) && week >= 0 && week <= MAX_WEEK_AHEAD ? week : 0;
}

/** Если по тексту встречи нельзя понять, когда она заканчивается. */
export const DEFAULT_MEETING_MIN = 90;

/** Встреча на тепловой карте: день и минуты в поясе группы. */
export type MeetingSpan = { id: number; date: DateStr; start: number; end: number; title: string };

/**
 * Когда идёт встреча. Длительность отдельно не хранится, но в тексте времени
 * встречи, выбранной в окнах, есть «15:00–16:30» — конец берём оттуда, если
 * начало совпадает с сохранённым. Иначе считаем полтора часа.
 */
export function meetingSpan(
  meeting: Pick<Meeting, "id" | "whenStart" | "whenText" | "goal" | "place">,
  tz: string,
): MeetingSpan | null {
  if (!meeting.whenStart) return null;
  const { day, minutes } = utcToZonedWall(meeting.whenStart, tz);
  let end = minutes + DEFAULT_MEETING_MIN;
  const range = /(\d{1,2}):(\d{2})\s*[–—-]\s*(\d{1,2}):(\d{2})/.exec(meeting.whenText);
  if (range) {
    const from = Number(range[1]) * 60 + Number(range[2]);
    const to = Number(range[3]) * 60 + Number(range[4]);
    if (from === minutes && to > from) end = to;
  }
  return {
    id: meeting.id,
    date: day,
    start: minutes,
    end: Math.min(end, 24 * 60),
    title: meeting.goal || meeting.place || meeting.whenText,
  };
}

export type GroupState = {
  members: User[];
  names: Map<number, string>;
  filledIds: Set<number>;
  missing: User[];
  grid: HeatDay[];
  slotDays: DaySlots[];
  /** Те, для кого считаются окна: выбранные участники с заполненным расписанием. */
  participants: PersonSchedule[];
  /** Все участники с заполненным расписанием — по ним рисуется тепловая карта. */
  groupParticipants: PersonSchedule[];
  quorum: number;
  everyone: boolean;
  /** Сколько человек в расчёте окон. */
  total: number;
  /** Кого выбрали для окон; null — всех. */
  selected: number[] | null;
  today: DateStr;
  periods: Period[];
  meetings: Meeting[];
  responses: Map<number, MeetingResponse[]>;
  duration: number;
  /** Назначенные встречи на неделе тепловой карты. */
  weekMeetings: MeetingSpan[];
  /** Какая неделя показана: 0 — текущая. */
  week: number;
  /** Понедельник показанной недели. */
  weekStart: DateStr;
};

export async function loadGroupState(
  chat: Chat,
  options: {
    quorum?: number | null;
    duration?: number | null;
    withMeetings?: boolean;
    week?: number;
    /** Окна только для этих участников; пусто или null — для всех. */
    only?: number[] | null;
  } = {},
): Promise<GroupState> {
  const { quorum = null, duration = null, withMeetings = true } = options;
  const week = normalizeWeek(options.week);

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
  const weekStart = addDays(today, -weekdayOf(today) + week * 7);
  // Для текущей недели варианты считаем от сегодня (прошедшие дни не нужны),
  // для будущей — с её понедельника.
  const slotsStart = week === 0 ? today : weekStart;
  const periods = gridPeriods(chat.dayStartMin, chat.dayEndMin, SLOT_STEP);
  const tz = chatTz(chat);
  const weekFrom = zonedWallToUtc(weekStart, 0, tz);
  const weekTo = zonedWallToUtc(addDays(weekStart, DAYS_AHEAD), 0, tz);
  const oneOff = (await repo.openMeetingsBetween(chat.chatId, weekFrom, weekTo)).map((meeting) =>
    meetingSpan(meeting, tz),
  );
  // Повторяющаяся встреча занимает свои клетки в каждой неделе серии.
  const repeated = (await repo.recurringMeetings(chat.chatId, weekStart, weekTo)).flatMap((meeting) =>
    occurrencesBetween(meeting.whenStart!, meeting.repeatUntil, tz, weekFrom, weekTo).map((start) =>
      meetingSpan({ ...meeting, whenStart: start }, tz),
    ),
  );
  const weekMeetings = [...oneOff, ...repeated].filter((span): span is MeetingSpan => span !== null);

  const grid = heatmap(people, weekStart, {
    daysAhead: DAYS_AHEAD,
    dayStart: chat.dayStartMin,
    dayEnd: chat.dayEndMin,
    step: SLOT_STEP,
    parityOf,
    bufferMin: chat.travelBufferMin,
    rows: periods,
  });

  // Окна можно считать не для всей группы, а для тех, кто должен прийти:
  // тепловая карта при этом остаётся картиной всей группы.
  const memberIds = new Set(members.map((member) => member.userId));
  const only = options.only?.filter((id) => memberIds.has(id)) ?? [];
  const selected = only.length > 0 ? only : null;
  const slotPeople = selected ? people.filter((person) => selected.includes(person.userId)) : people;

  const slots = slotsOfLength(slotPeople, slotsStart, {
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
    groupParticipants: people.filter((person) => person.hasData),
    quorum: slots.quorum,
    everyone: slots.everyone,
    total: slots.participants.length,
    selected,
    today,
    periods,
    meetings: meetingRows,
    responses,
    duration: length,
    weekMeetings,
    week,
    weekStart,
  };
}

/** Одно из предложений блока «Лучшее время». */
/**
 * Одно из предложений блока «Лучшее время». Если в несколько дней лучшим
 * оказывается одно и то же время, это одна строка с несколькими днями, а не
 * три одинаковые карточки подряд.
 */
export type BoardBest = BoardSlot & {
  dates: { date: string; label: string; short: string }[];
};

export type BoardSlot = {
  start: number;
  end: number;
  text: string;
  count: number;
  missing: string[];
};

/** Сериализуемая порция данных для клиентской доски. */
export type BoardPayload = {
  /** Участники с расписанием во всей группе — знаменатель тепловой карты. */
  total: number;
  /** Сколько человек в расчёте окон и «лучшего времени». */
  selectedTotal: number;
  /** Вся группа для списка «кто должен прийти». */
  people: { id: number; name: string; filled: boolean }[];
  /** Кого выбрали для окон; null — всех. */
  selected: number[] | null;
  quorum: number;
  everyone: boolean;
  duration: number;
  /** Показанная неделя: 0 — текущая. */
  week: number;
  /** Подпись недели вида «14–20 сент». */
  weekLabel: string;
  /** Два-три лучших окна недели — главный ответ страницы. */
  best: BoardBest[];
  /** Ряды тепловой карты: номер пары и перерыв перед ней. */
  periods: Period[];
  /** Назначенные встречи — их клетки на карте красные. */
  meetings: MeetingSpan[];
  days: {
    date: string;
    label: string;
    /** Подписи столбца: «Ср» и «16.09». */
    short: string;
    dm: string;
    /** `free` — кто свободен всю клетку, `missing` — кто занят (для подсказки при наведении). */
    cells: {
      start: number;
      end: number;
      count: number;
      free: string[];
      missing: string[];
      /** Занят ли в этой клетке тот, кто смотрит на карту. */
      mine: boolean;
    }[];
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

export function toBoardPayload(state: GroupState, lang: string, viewerId?: number): BoardPayload {
  // Свою занятость видно прямо на общей карте: без неё непонятно, ты ли тот
  // человек, которого не хватает. Если расписание ещё не заполнено, помечать нечего.
  const viewerHasData =
    viewerId !== undefined && state.groupParticipants.some((person) => person.userId === viewerId);
  // Клетки карты — про всю группу, окна — про выбранных.
  const namesOf = (list: readonly PersonSchedule[], ids: readonly number[], inside: boolean) =>
    list
      .filter((person) => ids.includes(person.userId) === inside)
      .map((person) => state.names.get(person.userId) ?? "?");
  const freeNames = (freeIds: readonly number[]) => namesOf(state.groupParticipants, freeIds, true);
  const missingNames = (freeIds: readonly number[]) =>
    namesOf(state.groupParticipants, freeIds, false);
  const slotMissing = (freeIds: readonly number[]) => namesOf(state.participants, freeIds, false);

  return {
    total: state.groupParticipants.length,
    selectedTotal: state.total,
    people: state.members
      .map((member) => ({
        id: member.userId,
        name: displayName(member),
        filled: state.filledIds.has(member.userId),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, lang)),
    selected: state.selected,
    quorum: state.quorum,
    everyone: state.everyone,
    duration: state.duration,
    week: state.week,
    weekLabel: `${formatDM(state.weekStart)} – ${formatDM(addDays(state.weekStart, 6))}`,
    best: bestSlots(state, lang),
    periods: state.periods,
    meetings: state.weekMeetings,
    days: state.grid.map((day) => ({
      date: day.day,
      label: formatDay(lang, day.day),
      short: weekdayShort(lang, weekdayOf(day.day)),
      dm: formatDM(day.day),
      cells: day.cells.map((cell) => ({
        start: cell.startMin,
        end: cell.endMin,
        count: cell.freeIds.length,
        free: freeNames(cell.freeIds),
        missing: missingNames(cell.freeIds),
        mine: viewerHasData && !cell.freeIds.includes(viewerId!),
      })),
    })),
    slotDays: state.slotDays.map((day) => ({
      date: day.day,
      label: formatDay(lang, day.day),
      short: `${weekdayShort(lang, weekdayOf(day.day))} ${formatDM(day.day)}`,
      items: mergeRuns(day.slots).map((run) => ({
        start: run.interval[0],
        end: run.interval[1],
        text: fmtInterval(run.interval),
        count: run.freeIds.length,
        missing: slotMissing(run.freeIds),
      })),
    })),
    missing: state.missing.map((member) => displayName(member)),
  };
}

/** Сколько предложений показываем в блоке «Лучшее время». */
const BEST_LIMIT = 3;

/**
 * Лучшие окна недели: по одному на день, дальше — самые «полные» и ранние.
 *
 * Страница существует ради ответа «когда мы можем встретиться», поэтому его
 * нужно назвать вслух, а не заставлять человека вычитывать тепловую карту.
 * Окна, на которые уже назначена встреча, из выдачи убираем: предлагать время,
 * которое группа только что заняла, — худший вид совета.
 */
export function bestSlots(state: GroupState, lang: string): BoardBest[] {
  const missingNames = (freeIds: readonly number[]) =>
    state.participants
      .filter((person) => !freeIds.includes(person.userId))
      .map((person) => state.names.get(person.userId) ?? "?");

  // Середина рабочего дня группы — по её же сетке пар.
  const noon =
    state.periods.length > 0
      ? (state.periods[0].start + state.periods[state.periods.length - 1].end) / 2
      : 13 * 60;
  const distanceToNoon = (start: number) => Math.abs(start - noon);

  const candidates: (BoardSlot & { date: string; label: string; short: string })[] = [];
  for (const day of state.slotDays) {
    const free = day.slots.filter(
      (slot) =>
        !state.weekMeetings.some(
          (meeting) =>
            meeting.date === day.day &&
            meeting.start < slot.interval[1] &&
            slot.interval[0] < meeting.end,
        ),
    );
    if (free.length === 0) continue;
    // Из окон с одинаковым числом людей берём то, что ближе к середине дня:
    // иначе «лучшим» всегда оказывается 8 утра — просто потому, что оно первое.
    const best = free.reduce((a, b) => {
      if (b.freeIds.length !== a.freeIds.length) return b.freeIds.length > a.freeIds.length ? b : a;
      return distanceToNoon(b.interval[0]) < distanceToNoon(a.interval[0]) ? b : a;
    });
    candidates.push({
      date: day.day,
      label: formatDay(lang, day.day),
      short: `${weekdayShort(lang, weekdayOf(day.day))} ${formatDM(day.day)}`,
      start: best.interval[0],
      end: best.interval[1],
      text: fmtInterval(best.interval),
      count: best.freeIds.length,
      missing: missingNames(best.freeIds),
    });
  }

  candidates.sort((a, b) => b.count - a.count || a.date.localeCompare(b.date) || a.start - b.start);

  // Одинаковое время с одинаковым составом в разные дни — одна строка.
  const groups: BoardBest[] = [];
  for (const candidate of candidates) {
    const same = groups.find(
      (group) =>
        group.start === candidate.start &&
        group.end === candidate.end &&
        group.count === candidate.count &&
        group.missing.join("|") === candidate.missing.join("|"),
    );
    const day = { date: candidate.date, label: candidate.label, short: candidate.short };
    if (same) same.dates.push(day);
    else {
      groups.push({
        start: candidate.start,
        end: candidate.end,
        text: candidate.text,
        count: candidate.count,
        missing: candidate.missing,
        dates: [day],
      });
    }
  }
  return groups.slice(0, BEST_LIMIT);
}

/**
 * Склеить окна, идущие подряд с одним и тем же составом, в один диапазон.
 *
 * Варианты считаются с шагом в полчаса, и раньше день выглядел как 28 строк
 * «08:00–08:30», «08:30–09:00»… с одними и теми же людьми. Человеку нужен
 * ответ «с 8 до 10:30 свободны все», а не перечень всех стартов.
 */
export function mergeRuns(
  slots: readonly { interval: readonly [number, number]; freeIds: readonly number[] }[],
): { interval: [number, number]; freeIds: number[] }[] {
  const runs: { interval: [number, number]; freeIds: number[] }[] = [];
  const sameIds = (a: readonly number[], b: readonly number[]) =>
    a.length === b.length && a.every((id) => b.includes(id));
  for (const slot of slots) {
    const last = runs[runs.length - 1];
    // Соседние варианты перекрываются: следующий начинается раньше, чем кончился прошлый.
    if (last && slot.interval[0] <= last.interval[1] && sameIds(last.freeIds, slot.freeIds)) {
      last.interval[1] = Math.max(last.interval[1], slot.interval[1]);
    } else {
      runs.push({ interval: [slot.interval[0], slot.interval[1]], freeIds: [...slot.freeIds] });
    }
  }
  return runs;
}
