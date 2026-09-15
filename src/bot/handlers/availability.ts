/** Команда /free (она же /availability) — общие свободные окна в группе, в том числе по кворуму. */

import "server-only";

import {
  type AvailabilityResult,
  type ParityOf,
  anyWindows,
  computeAvailability,
  parityFromSemesterStart,
} from "@/core/availability";
import { fmtInterval, fmtMinutes } from "@/core/intervals";
import { clip, escapeHtml } from "@/core/textutils";
import { type DateStr, chatTz, todayIn } from "@/core/timeutils";
import * as repo from "@/db/repo";
import type { Chat, User } from "@/db/schema";
import { formatDay, t } from "@/i18n";
import { isGroup, sendMessage, type TgMessage } from "../api";
import {
  extractMentionedUsers,
  extractMinDuration,
  mentionList,
  plainNames,
  syncUser,
} from "../context";

const PERCENT_RE = /^(\d{1,3})%$/;
const QUORUM_RE = /^(?:q|кворум|кв)(\d{1,3})$/i;

/** `80%` → 80% участников, `q8` / `кворум8` → ровно 8 человек. null — нужны все. */
export function parseQuorum(args: string[], total: number): number | null {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const percent = PERCENT_RE.exec(arg);
    if (percent) {
      const value = Number(percent[1]);
      return Math.max(1, Math.min(total, Math.round((total * value) / 100)));
    }
    const absolute = QUORUM_RE.exec(arg);
    if (absolute) {
      return Math.max(1, Math.min(total, Number(absolute[1])));
    }
    if (["кворум", "quorum", "кв", "q"].includes(arg.toLowerCase()) && index + 1 < args.length) {
      const next = args[index + 1];
      if (/^\d+$/.test(next)) return Math.max(1, Math.min(total, Number(next)));
    }
  }
  return null;
}

/** /free в группе: общие окна участников этого чата. В личке команда ведёт на сайт (см. router). */
export async function cmdAvailability(message: TgMessage, args: string[]): Promise<void> {
  const from = message.from;
  if (!from || !isGroup(message.chat)) return;

  await syncUser(from);
  await repo.upsertChat(message.chat.id, message.chat.title ?? "");
  await repo.addMembership(message.chat.id, from.id);
  const text = await buildReport(message, message.chat.id, args);
  await sendMessage({
    chat_id: message.chat.id,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
}

async function buildReport(
  message: TgMessage,
  chatId: number,
  args: string[],
): Promise<string> {
  const chat = await repo.getChat(chatId);
  if (!chat) return t("ru", "chat_not_setup");
  const lang = chat.lang;

  const members = await repo.chatMembers(chatId);
  if (members.length === 0) return t(lang, "avail_no_members");

  const { found: mentioned, missing: unknown } = await extractMentionedUsers(message);

  let selected: User[];
  let who: string;
  if (mentioned.length) {
    const caller = message.from ? await repo.getUser(message.from.id) : null;
    const seen = new Set<number>();
    selected = [];
    for (const user of [...(caller ? [caller] : []), ...mentioned]) {
      if (!seen.has(user.userId)) {
        seen.add(user.userId);
        selected.push(user);
      }
    }
    who = t(lang, "avail_selected", { count: selected.length, names: plainNames(selected) });
  } else {
    selected = members;
    who = t(lang, "avail_all", { count: selected.length });
  }

  const minimum = extractMinDuration(args, chat.minSlotMin);
  const people = await repo.buildPersonSchedules(selected);
  const idToUser = new Map(selected.map((user) => [user.userId, user]));

  const withData = people.filter((person) => person.hasData);
  if (withData.length === 0) return t(lang, "avail_need_schedule");

  const quorum = parseQuorum(args, withData.length);
  const parityOf = chat.semesterStart ? parityFromSemesterStart(chat.semesterStart) : null;
  const today = todayIn(chatTz(chat));

  const result = computeAvailability(people, today, {
    daysAhead: 7,
    dayStart: chat.dayStartMin,
    dayEnd: chat.dayEndMin,
    minSlot: minimum,
    quorum,
    parityOf,
    bufferMin: chat.travelBufferMin,
  });

  let text = render(result, lang, who, idToUser, chat, parityOf, today);
  if (unknown.length) {
    text +=
      "\n" +
      unknown
        .slice(0, 3)
        .map((name) => t(lang, "avail_user_not_found", { name: escapeHtml(name) }))
        .join("\n");
  }
  // Telegram режет сообщения длиннее 4096 символов — на большой группе
  // список окон легко перевалит лимит, и сообщение просто не уйдёт.
  return clip(text, 3900, t(lang, "avail_clipped"));
}

function render(
  result: AvailabilityResult,
  lang: string,
  who: string,
  idToUser: Map<number, User>,
  chat: Chat,
  parityOf: ParityOf | null,
  today: DateStr,
): string {
  const total = result.participants.length;

  let text = result.everyone
    ? t(lang, "avail_title", { who })
    : t(lang, "avail_quorum_title", { quorum: result.quorum, total, who });

  if (parityOf) {
    const parityKey = parityOf(today) === 0 ? "parity_odd" : "parity_even";
    text += t(lang, "avail_parity_note", { parity: t(lang, parityKey) });
  }

  if (!anyWindows(result)) {
    const key = result.everyone ? "avail_none" : "avail_quorum_none";
    text += "\n" + t(lang, key, { min: result.minSlot, quorum: result.quorum });
  } else {
    for (const day of result.days) {
      if (day.windows.length === 0) continue;
      text += `\n<b>${formatDay(lang, day.day)}</b>\n`;
      for (const window of day.windows) {
        text += `<code>${fmtInterval(window.interval)}</code>\n`;
        if (result.everyone) continue;
        const absent = result.participants
          .filter(
            (person) => !window.freeIds.includes(person.userId) && idToUser.has(person.userId),
          )
          .map((person) => idToUser.get(person.userId)!);
        text += absent.length
          ? t(lang, "avail_quorum_line", {
              count: window.freeIds.length,
              total,
              missing: plainNames(absent),
            }) + "\n"
          : t(lang, "avail_quorum_all") + "\n";
      }
    }
  }

  if (result.missing.length) {
    const missingUsers = result.missing
      .filter((person) => idToUser.has(person.userId))
      .map((person) => idToUser.get(person.userId)!);
    text += t(lang, "avail_missing_note", { names: mentionList(missingUsers) });
  }

  text += t(lang, "avail_hint", {
    start: fmtMinutes(chat.dayStartMin),
    end: fmtMinutes(chat.dayEndMin),
    min: result.minSlot,
  });
  return text;
}
