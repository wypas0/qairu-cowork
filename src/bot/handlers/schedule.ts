/** Ввод расписания в личке: /schedule, /import, /wizard, /myschedule, /clear, /busy. */

import "server-only";

import { fmtMinutes } from "@/core/intervals";
import {
  type ParseResult,
  findKind,
  findRangesWithPos,
  isAllDay,
  parseAny,
  parseResultOk,
} from "@/core/parser";
import { escapeHtml } from "@/core/textutils";
import {
  type DateStr,
  compareDates,
  formatDM,
  formatDMY,
  parseDateToken,
  todayIn,
} from "@/core/timeutils";
import * as repo from "@/db/repo";
import { DEFAULT_TZ } from "@/core/timeutils";
import { t, weekdayName } from "@/i18n";
import {
  answerCallbackQuery,
  editMessageText,
  keyboard,
  sendMessage,
  type TgCallbackQuery,
  type TgMessage,
} from "../api";
import {
  type SlotTuple,
  clearPrivateState,
  getPrivateState,
  resolveLang,
  setPrivateState,
  syncUser,
} from "../context";

// --------------------------------------------------------------------------
// Импорт расписания текстом
// --------------------------------------------------------------------------

export async function cmdSchedule(message: TgMessage): Promise<void> {
  if (message.from) {
    await syncUser(message.from);
    await clearPrivateState(message.from.id);
  }
  const lang = await resolveLang(message.chat, message.from);
  await sendMessage({
    chat_id: message.chat.id,
    text: t(lang, "schedule_intro"),
    parse_mode: "HTML",
  });
}

function slotSuffix(lang: string, label: string, parity: number | null, kind: string): string {
  const parts: string[] = [];
  if (label) parts.push(escapeHtml(label));
  if (parity !== null) parts.push(t(lang, parity === 0 ? "parity_odd" : "parity_even"));
  if (kind && kind !== "class") parts.push(t(lang, `kind_${kind}`));
  return parts.length ? ` <i>(${parts.join(", ")})</i>` : "";
}

function renderParsePreview(result: ParseResult, lang: string): string {
  const byDay = new Map<number, SlotTuple[]>();
  for (const slot of result.slots) {
    const list = byDay.get(slot.weekday) ?? [];
    list.push({
      weekday: slot.weekday,
      start: slot.startMin,
      end: slot.endMin,
      label: slot.label,
      parity: slot.parity,
      kind: slot.kind,
    });
    byDay.set(slot.weekday, list);
  }

  const lines: string[] = [];
  for (let weekday = 0; weekday < 7; weekday += 1) {
    const items = byDay.get(weekday);
    if (items) {
      const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end);
      const rendered = sorted
        .map(
          (item) =>
            `${fmtMinutes(item.start)}–${fmtMinutes(item.end)}` +
            slotSuffix(lang, item.label, item.parity, item.kind),
        )
        .join(", ");
      lines.push(`<b>${weekdayName(lang, weekday)}</b>: ${rendered}`);
    } else if (result.freeDays.includes(weekday)) {
      lines.push(`<b>${weekdayName(lang, weekday)}</b>: ${t(lang, "day_free")}`);
    }
  }
  return lines.join("\n") || "—";
}

/** Свободный текст в личке — это и есть импорт расписания. */
export async function onScheduleText(message: TgMessage): Promise<void> {
  const from = message.from;
  if (!from) return;

  await syncUser(from);
  const lang = await resolveLang(message.chat, from);
  const result = parseAny(message.text ?? "");

  if (!parseResultOk(result)) {
    await sendMessage({
      chat_id: message.chat.id,
      text: t(lang, "parse_failed"),
      parse_mode: "HTML",
    });
    return;
  }

  await setPrivateState(from.id, {
    mode: "import_confirm",
    slots: result.slots.map((slot) => ({
      weekday: slot.weekday,
      start: slot.startMin,
      end: slot.endMin,
      label: slot.label,
      parity: slot.parity,
      kind: slot.kind,
    })),
    freeDays: result.freeDays,
  });

  let body = t(lang, "parse_preview", { schedule: renderParsePreview(result, lang) });
  if (result.errors.length) {
    body += t(lang, "parse_errors", {
      lines: escapeHtml(result.errors.slice(0, 5).join("\n")),
    });
  }

  await sendMessage({
    chat_id: message.chat.id,
    text: body,
    parse_mode: "HTML",
    reply_markup: keyboard([
      [
        { text: t(lang, "btn_confirm"), callback_data: "sch:ok" },
        { text: t(lang, "btn_retry"), callback_data: "sch:retry" },
      ],
    ]),
  });
}

export async function onScheduleConfirm(query: TgCallbackQuery): Promise<void> {
  const message = query.message;
  if (!message) return;
  await answerCallbackQuery({ callback_query_id: query.id });

  const action = (query.data ?? "").split(":")[1];
  const lang = await resolveLang(message.chat, query.from);

  if (action === "retry") {
    await clearPrivateState(query.from.id);
    await editMessageText({
      chat_id: message.chat.id,
      message_id: message.message_id,
      text: t(lang, "schedule_intro"),
      parse_mode: "HTML",
    });
    return;
  }

  const state = await getPrivateState(query.from.id);
  if (state?.mode !== "import_confirm") {
    await editMessageText({
      chat_id: message.chat.id,
      message_id: message.message_id,
      text: t(lang, "error_generic"),
    });
    return;
  }
  await clearPrivateState(query.from.id);

  const touched = [...new Set([...state.slots.map((s) => s.weekday), ...state.freeDays])].sort(
    (a, b) => a - b,
  );
  await repo.replaceWeeklySlots(query.from.id, touched, state.slots, "import");

  await editMessageText({
    chat_id: message.chat.id,
    message_id: message.message_id,
    text: t(lang, "schedule_saved"),
  });
}

// --------------------------------------------------------------------------
// Мастер по дням
// --------------------------------------------------------------------------

function dayKeyboard(lang: string) {
  const rows: { text: string; callback_data: string }[][] = [];
  let row: { text: string; callback_data: string }[] = [];
  for (let weekday = 0; weekday < 7; weekday += 1) {
    row.push({ text: weekdayName(lang, weekday).slice(0, 3), callback_data: `wiz:day:${weekday}` });
    if (row.length === 4) {
      rows.push(row);
      row = [];
    }
  }
  if (row.length) rows.push(row);
  rows.push([{ text: t(lang, "btn_done"), callback_data: "wiz:done" }]);
  return keyboard(rows);
}

export async function cmdWizard(message: TgMessage): Promise<void> {
  const from = message.from;
  if (!from) return;
  await syncUser(from);
  const lang = await resolveLang(message.chat, from);
  await setPrivateState(from.id, { mode: "wizard", weekday: null });
  await sendMessage({
    chat_id: message.chat.id,
    text: t(lang, "wizard_pick_day"),
    reply_markup: dayKeyboard(lang),
  });
}

export async function onWizardDay(query: TgCallbackQuery): Promise<void> {
  const message = query.message;
  if (!message) return;
  await answerCallbackQuery({ callback_query_id: query.id });
  const lang = await resolveLang(message.chat, query.from);

  if (query.data === "wiz:done") {
    await repo.markFilled(query.from.id, true);
    await clearPrivateState(query.from.id);
    await editMessageText({
      chat_id: message.chat.id,
      message_id: message.message_id,
      text: t(lang, "wizard_done"),
    });
    return;
  }

  const weekday = Number((query.data ?? "").split(":").pop());
  await setPrivateState(query.from.id, { mode: "wizard", weekday });
  await editMessageText({
    chat_id: message.chat.id,
    message_id: message.message_id,
    text: t(lang, "wizard_ask_day", { day: weekdayName(lang, weekday) }),
    parse_mode: "HTML",
  });
}

export async function onWizardText(message: TgMessage, weekday: number | null): Promise<void> {
  const from = message.from;
  if (!from) return;
  const lang = await resolveLang(message.chat, from);

  if (weekday === null) {
    await sendMessage({ chat_id: message.chat.id, text: t(lang, "error_generic") });
    await clearPrivateState(from.id);
    return;
  }

  const ranges = findRangesWithPos(message.text ?? "");
  const slots = ranges.map((range) => ({
    weekday,
    start: range.start,
    end: range.end,
    label: "",
    parity: null,
    kind: "class",
  }));
  await repo.replaceWeeklySlots(from.id, [weekday], slots, "wizard");
  await setPrivateState(from.id, { mode: "wizard", weekday: null });

  const rendered =
    slots.map((slot) => `${fmtMinutes(slot.start)}–${fmtMinutes(slot.end)}`).join(", ") ||
    t(lang, "day_free");

  await sendMessage({
    chat_id: message.chat.id,
    text: t(lang, "wizard_day_saved", { day: weekdayName(lang, weekday), slots: rendered }),
  });
  await sendMessage({
    chat_id: message.chat.id,
    text: t(lang, "wizard_pick_day"),
    reply_markup: dayKeyboard(lang),
  });
}

// --------------------------------------------------------------------------
// Просмотр, очистка, разовая занятость
// --------------------------------------------------------------------------

export async function cmdMySchedule(message: TgMessage): Promise<void> {
  const from = message.from;
  if (!from) return;
  await syncUser(from);
  const lang = await resolveLang(message.chat, from);
  const slots = await repo.getSlots(from.id);

  if (slots.length === 0) {
    await sendMessage({ chat_id: message.chat.id, text: t(lang, "schedule_empty") });
    return;
  }

  const weekly = new Map<number, SlotTuple[]>();
  const dated: string[] = [];
  for (const slot of slots) {
    if (slot.specificDate !== null) {
      dated.push(
        `📌 <b>${formatDMY(slot.specificDate)}</b>: ` +
          `${fmtMinutes(slot.startMin)}–${fmtMinutes(slot.endMin)}` +
          slotSuffix(lang, slot.label, null, slot.kind),
      );
    } else if (slot.dateFrom !== null && slot.dateTo !== null) {
      dated.push(
        `📌 <b>${formatDM(slot.dateFrom)}–${formatDMY(slot.dateTo)}</b>: ` +
          `${fmtMinutes(slot.startMin)}–${fmtMinutes(slot.endMin)}` +
          slotSuffix(lang, slot.label, null, slot.kind),
      );
    } else if (slot.weekday !== null) {
      const list = weekly.get(slot.weekday) ?? [];
      list.push({
        weekday: slot.weekday,
        start: slot.startMin,
        end: slot.endMin,
        label: slot.label,
        parity: slot.weekParity,
        kind: slot.kind,
      });
      weekly.set(slot.weekday, list);
    }
  }

  const lines: string[] = [];
  for (let weekday = 0; weekday < 7; weekday += 1) {
    const items = [...(weekly.get(weekday) ?? [])].sort(
      (a, b) => a.start - b.start || a.end - b.end,
    );
    const value =
      items
        .map(
          (item) =>
            `${fmtMinutes(item.start)}–${fmtMinutes(item.end)}` +
            slotSuffix(lang, item.label, item.parity, item.kind),
        )
        .join(", ") || t(lang, "day_free");
    lines.push(`<b>${weekdayName(lang, weekday)}</b>: ${value}`);
  }
  lines.push(...[...dated].sort());

  await sendMessage({
    chat_id: message.chat.id,
    text: t(lang, "my_schedule", { schedule: lines.join("\n") }),
    parse_mode: "HTML",
  });
}

export async function cmdClear(message: TgMessage): Promise<void> {
  const lang = await resolveLang(message.chat, message.from);
  await sendMessage({
    chat_id: message.chat.id,
    text: t(lang, "clear_confirm"),
    reply_markup: keyboard([
      [
        { text: t(lang, "btn_yes_delete"), callback_data: "clr:yes" },
        { text: t(lang, "btn_no"), callback_data: "clr:no" },
      ],
    ]),
  });
}

export async function onClearChoice(query: TgCallbackQuery): Promise<void> {
  const message = query.message;
  if (!message) return;
  await answerCallbackQuery({ callback_query_id: query.id });
  const lang = await resolveLang(message.chat, query.from);

  if (query.data === "clr:yes") {
    await repo.clearSchedule(query.from.id);
    await editMessageText({
      chat_id: message.chat.id,
      message_id: message.message_id,
      text: t(lang, "cleared"),
    });
  } else {
    await editMessageText({
      chat_id: message.chat.id,
      message_id: message.message_id,
      text: t(lang, "cancelled"),
    });
  }
}

export async function cmdBusy(message: TgMessage): Promise<void> {
  const from = message.from;
  if (!from) return;
  await syncUser(from);
  const lang = await resolveLang(message.chat, from);
  await setPrivateState(from.id, { mode: "busy" });
  await sendMessage({ chat_id: message.chat.id, text: t(lang, "busy_ask"), parse_mode: "HTML" });
}

// Разделяем и по «12.09-15.09»: дефис между датами — не часть токена.
const BUSY_SEPARATOR = /[\s,;]+|(?<=\d)[–—](?=\d)|(?<=\d)-(?=\d{1,2}[./-])/gu;

type Token = { value: string; start: number; end: number };

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const separator = new RegExp(BUSY_SEPARATOR.source, BUSY_SEPARATOR.flags);
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = separator.exec(text)) !== null) {
    tokens.push({ value: text.slice(cursor, match.index), start: cursor, end: match.index });
    cursor = match.index + match[0].length;
  }
  tokens.push({ value: text.slice(cursor), start: cursor, end: text.length });
  return tokens.filter((token) => token.value !== "");
}

/**
 * Даты сообщения и текст без них. Две даты = диапазон (сессия, поездка).
 *
 * Даты вырезаются из текста, потому что «15.09-20.09» само по себе выглядит
 * как диапазон времени 15:09–20:09: точка в разборе времени равноправна
 * двоеточию. Без этой маски «15.09-20.09 сессия» записывалось бы не сессией
 * на неделю, а часом с небольшим каждый день.
 */
function extractDates(
  text: string,
  today: DateStr,
): { dates: DateStr[]; withoutDates: string } {
  const dates: DateStr[] = [];
  let masked = text;

  for (const token of tokenize(text)) {
    const day = parseDateToken(token.value, today);
    if (!day) continue;
    if (!dates.includes(day)) dates.push(day);
    // Замена той же длины — позиции остальных токенов не съезжают.
    masked =
      masked.slice(0, token.start) +
      " ".repeat(token.end - token.start) +
      masked.slice(token.end);
  }
  return { dates, withoutDates: masked };
}

/** Название занятости: всё, что не дата и не диапазон времени. */
function busyLabel(text: string, today: DateStr): string {
  const words: string[] = [];
  for (const token of text.split(/[\s,;]+/u)) {
    if (!token) continue;
    if (parseDateToken(token, today)) continue;
    if (/^[\d:.\-–—/hч]+$/u.test(token)) continue; // даты-диапазоны и времена
    words.push(token);
  }
  let label = words.join(" ");
  const trim = " .:,;-–—";
  let start = 0;
  let end = label.length;
  while (start < end && trim.includes(label[start])) start += 1;
  while (end > start && trim.includes(label[end - 1])) end -= 1;
  label = label.slice(start, end);
  return label.slice(0, 60);
}

export async function onBusyText(message: TgMessage): Promise<void> {
  const from = message.from;
  if (!from) return;
  const lang = await resolveLang(message.chat, from);
  const text = message.text ?? "";
  const today = todayIn(DEFAULT_TZ);

  const { dates, withoutDates } = extractDates(text, today);
  if (dates.length === 0) {
    await sendMessage({ chat_id: message.chat.id, text: t(lang, "busy_bad"), parse_mode: "HTML" });
    return;
  }

  let ranges = findRangesWithPos(withoutDates).map((range) => ({
    start: range.start,
    end: range.end,
  }));
  // «12.09 весь день» и «15.09-20.09 сессия» — время не указано, значит занят целиком.
  if (ranges.length === 0) {
    if (isAllDay(text) || dates.length > 1) {
      ranges = [{ start: 0, end: 24 * 60 }];
    } else {
      await sendMessage({
        chat_id: message.chat.id,
        text: t(lang, "busy_bad"),
        parse_mode: "HTML",
      });
      return;
    }
  }

  const kind = findKind(text);
  const label = busyLabel(text, today);
  const rendered = ranges
    .map((range) => `${fmtMinutes(range.start)}–${fmtMinutes(range.end)}`)
    .join(", ");

  await clearPrivateState(from.id);

  if (dates.length > 1) {
    const sorted = [...dates].sort(compareDates);
    const dateFrom = sorted[0];
    const dateTo = sorted[sorted.length - 1];
    for (const range of ranges) {
      await repo.addRangeSlot({
        userId: from.id,
        dateFrom,
        dateTo,
        start: range.start,
        end: range.end,
        label,
        kind,
      });
    }
    await sendMessage({
      chat_id: message.chat.id,
      text: t(lang, "busy_range_saved", {
        date_from: formatDMY(dateFrom),
        date_to: formatDMY(dateTo),
        time: rendered,
      }),
    });
    return;
  }

  for (const range of ranges) {
    await repo.addDatedSlot({
      userId: from.id,
      day: dates[0],
      start: range.start,
      end: range.end,
      label,
      kind,
    });
  }
  await sendMessage({
    chat_id: message.chat.id,
    text: t(lang, "busy_saved", { date: formatDMY(dates[0]), time: rendered }),
  });
}
