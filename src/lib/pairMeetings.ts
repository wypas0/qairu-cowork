/**
 * Встреча вдвоём с другом — единственная дверь для сайта (бот отвечает на
 * её карточку теми же кнопками, что у встреч группы: bot/handlers/meeting).
 *
 * Группы у такой встречи нет (meetings.chat_id = NULL, 0013), второй
 * человек — with_user. Пояс — по умолчанию (Asia/Almaty), как у «Когда вы
 * оба свободны». Права проверяются заново на каждом шаге по людям из базы:
 * подставить в форму чужой id или чужую встречу бесполезно.
 */

import "server-only";

import { FRIEND_LIMITS } from "@/core/friends";
import { fmtInterval } from "@/core/intervals";
import { meetingIsOver } from "@/core/recurrence";
import { PAIR_PLAN, pairPartner, parsePickedWhen, planDays } from "@/core/pairPlan";
import { type DateStr, addDays, isDateStr, todayIn, zonedWallToUtc } from "@/core/timeutils";
import * as repo from "@/db/repo";
import type { Meeting, User } from "@/db/schema";
import { formatDay } from "@/i18n";
import { defaultTz } from "./config";
import { relationOf } from "./friends";
import { notifyNonResponders, notifyPairCancelled, notifyPairMeetingCreated, notifyVote } from "./notify";

const DAY = 86_400_000;
/** «Напомнить» другу — не чаще раза в 10 минут, как у встреч группы. */
const PING_WINDOW_MS = 10 * 60 * 1000;

export type PairInput = {
  /** «2026-10-28T15:00|60» — из кнопок карточки друга. */
  when: string;
  goal: string;
  place: string;
  repeat: boolean;
  repeatUntil: string;
};

export type PairCreateOutcome =
  | { code: "meeting_sent" | "meeting_site"; meeting: Meeting }
  | { code: "meeting_time" | "throttled" | "not_friend" };

/** Встреча вдвоём, где `me` — один из двоих. Иначе null: чужая или групповая. */
async function ownPairMeeting(me: User, meetingId: number): Promise<Meeting | null> {
  const meeting = Number.isSafeInteger(meetingId) ? await repo.getMeeting(meetingId) : null;
  if (!meeting || meeting.withUser === null) return null;
  return pairPartner(meeting, me.userId) !== null && repo.inviteeIds(meeting).includes(me.userId) ? meeting : null;
}

/** Ещё не прошла и не отменена — на неё можно отвечать и её можно отменить. */
function isLive(meeting: Meeting, now: Date): boolean {
  return meeting.status === "open" && !meetingIsOver(meeting, now, todayIn(defaultTz(), now));
}

/**
 * Назначить встречу другу. Время — только выбранное кнопками («…|60»), в
 * пределах двух недель плана и часов 8–22; повтор — как у группы, до года.
 * Создатель сразу «приду»; другу — карточка в Telegram или ожидание на сайте.
 */
export async function createPairMeeting(
  me: User,
  friendId: number,
  input: PairInput,
  now = new Date(),
): Promise<PairCreateOutcome> {
  const friend = Number.isSafeInteger(friendId) ? await repo.getUser(friendId) : null;
  if (!friend || friend.isWeb || me.isWeb) return { code: "not_friend" };
  const rel = await relationOf(me.userId, friend.userId);
  if (!rel.friends || rel.blockedByMe || rel.blockedMe) return { code: "not_friend" };

  const picked = parsePickedWhen(input.when);
  const tz = defaultTz();
  const today = todayIn(tz, now);
  if (
    !picked ||
    !planDays(today).includes(picked.day) ||
    picked.start < PAIR_PLAN.dayStart ||
    picked.start + picked.duration > PAIR_PLAN.dayEnd ||
    picked.duration > 4 * 60
  ) {
    return { code: "meeting_time" };
  }
  const whenStart = zonedWallToUtc(picked.day, picked.start, tz);
  if (whenStart <= now) return { code: "meeting_time" };

  // Каждую неделю до выбранной даты — не дальше года и не раньше самой встречи.
  let repeatUntil: DateStr | null = null;
  if (input.repeat && isDateStr(input.repeatUntil) && input.repeatUntil >= picked.day) {
    const limit = addDays(picked.day, 366);
    repeatUntil = input.repeatUntil > limit ? limit : input.repeatUntil;
  }

  // Счётчик — после проверок: опечатка во времени не съедает лимит.
  if ((await repo.bumpCounter(`fr:pm:${me.userId}`, DAY)) > FRIEND_LIMITS.pairMeetingsPerDay) {
    return { code: "throttled" };
  }

  const meeting = await repo.createPairMeeting({
    initiatorId: me.userId,
    withUser: friend.userId,
    place: input.place.trim().slice(0, 200),
    goal: input.goal.trim().slice(0, 500),
    whenText: `${formatDay(me.lang, picked.day)} · ${fmtInterval([picked.start, picked.start + picked.duration])}`,
    whenStart,
    durationMin: picked.duration,
    repeatUntil,
  });
  await repo.setResponse({ meetingId: meeting.id, userId: me.userId, answer: "yes" });
  const delivery = await notifyPairMeetingCreated(meeting, me, friend);
  return { code: delivery.telegram > 0 ? "meeting_sent" : "meeting_site", meeting };
}

export type PairAnswerOutcome = "answered" | "gone" | "empty_comment";

/** Ответ на встречу вдвоём с сайта: «приду», «может быть», «не смогу» или «предложить другое». */
export async function answerPairMeeting(
  me: User,
  meetingId: number,
  answer: string,
  comment: string,
  now = new Date(),
): Promise<PairAnswerOutcome> {
  const meeting = await ownPairMeeting(me, meetingId);
  if (!meeting || !isLive(meeting, now)) return "gone";
  if (answer !== "yes" && answer !== "maybe" && answer !== "no" && answer !== "change") return "gone";
  const text = comment.trim().slice(0, 300);
  if (answer === "change" && !text) return "empty_comment";
  await repo.setResponse({ meetingId: meeting.id, userId: me.userId, answer, comment: text });
  await notifyVote(null, meeting, me, answer, text);
  return "answered";
}

/** Отменить может только тот, кто назначил; другу — сообщение, карточка у него гаснет. */
export async function cancelPairMeeting(me: User, meetingId: number, now = new Date()): Promise<"meeting_cancelled" | "gone"> {
  const meeting = await ownPairMeeting(me, meetingId);
  if (!meeting || meeting.initiatorId !== me.userId || !isLive(meeting, now)) return "gone";
  await repo.updateMeeting(meeting.id, { status: "cancelled" });
  const partner = await repo.getUser(meeting.withUser!);
  if (partner) await notifyPairCancelled(meeting, me, partner);
  return "meeting_cancelled";
}

/** «Напомнить» другу, который ещё не ответил: снова карточка с кнопками. */
export async function pingPairMeeting(
  me: User,
  meetingId: number,
  now = new Date(),
): Promise<"pinged" | "ping_site" | "throttled" | "gone"> {
  const meeting = await ownPairMeeting(me, meetingId);
  if (!meeting || meeting.initiatorId !== me.userId || !isLive(meeting, now)) return "gone";
  if ((await repo.bumpCounter(`ping:${meeting.id}`, PING_WINDOW_MS)) > 1) return "throttled";
  const delivery = await notifyNonResponders(null, meeting, me);
  return delivery.telegram > 0 ? "pinged" : delivery.site > 0 ? "ping_site" : "gone";
}

/** Встреча для файла .ics: только своя встреча вдвоём с этим другом. */
export async function pairMeetingWith(me: User, friendId: number, meetingId: number): Promise<Meeting | null> {
  const meeting = await ownPairMeeting(me, meetingId);
  return meeting && pairPartner(meeting, me.userId) === friendId ? meeting : null;
}
