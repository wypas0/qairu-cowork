"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { fmtMinutes } from "@/core/intervals";
import {
  type DateStr,
  addDays,
  chatTz,
  isDateStr,
  todayIn,
  utcToZonedWall,
  zonedWallToUtc,
} from "@/core/timeutils";
import * as repo from "@/db/repo";
import { type Chat, ROLE_ADMIN, ROLE_MEMBER, type User } from "@/db/schema";
import { formatDay, normalizeLang } from "@/i18n";
import { adminSource, isGroupAdmin, telegramAdminIds } from "@/lib/admin";
import { currentUser } from "@/lib/auth";
import { connectUrl, requireTelegramUser } from "@/lib/gate";
import {
  type Delivery,
  notifyFillSchedule,
  notifyMeetingCreated,
  notifyNonResponders,
  notifyVote,
} from "@/lib/notify";
import { afterJoinPath, afterNamePath } from "@/lib/afterJoin";
import { isOutdated, semesterCutoff } from "@/lib/group";

/** Не чаще раза в 10 минут на одного адресата — напоминание не должно становиться спамом. */
const REMIND_WINDOW_MS = 10 * 60 * 1000;

async function requireChat(slug: string): Promise<Chat> {
  const chat = await repo.getChatBySlug(slug);
  if (!chat) redirect("/");
  return chat;
}

async function requireMember(slug: string): Promise<{ chat: Chat; user: User }> {
  const chat = await requireChat(slug);
  const user = await currentUser();
  if (user?.isWeb) redirect(connectUrl(`/g/${slug}`));
  if (!user || !(await repo.isMember(chat.chatId, user.userId))) redirect(`/g/${slug}/join`);
  return { chat, user };
}

async function requireAdmin(slug: string): Promise<{ chat: Chat; user: User }> {
  const { chat, user } = await requireMember(slug);
  if (!(await isGroupAdmin(chat, user.userId))) redirect(`/g/${slug}?err=not_admin`);
  return { chat, user };
}

/**
 * Вернуться на страницу группы. Якорь передаётся параметром `at`: редирект
 * из серверного действия `#фрагмент` не сохраняет (см. ScrollToAnchor).
 */
function back(slug: string, params: Record<string, string> = {}, hash = ""): never {
  const all = hash ? { ...params, at: hash.replace(/^#/, "") } : params;
  const query = new URLSearchParams(all).toString();
  revalidatePath(`/g/${slug}`);
  redirect(`/g/${slug}${query ? `?${query}` : ""}`);
}

function deliveryParams(delivery: Delivery): Record<string, string> {
  return { sent: `${delivery.telegram}-${delivery.site}` };
}

/**
 * Вступить в группу по ссылке-приглашению. Только для вошедших через Telegram:
 * имя и фото берутся из Telegram, представляться отдельно не нужно.
 */
export async function joinGroup(slug: string): Promise<void> {
  const chat = await requireChat(slug);
  const user = await requireTelegramUser(`/g/${slug}/join`);
  await repo.addMembership(chat.chatId, user.userId);
  revalidatePath("/", "layout");
  redirect(await afterJoinPath(slug, user));
}

/**
 * «Как тебя подписать в группе?» — один вопрос сразу после вступления.
 *
 * Пустой ответ тоже ответ: тогда остаётся имя из Telegram, и больше мы не
 * спрашиваем. Имя общее для всех групп, как и расписание.
 */
export async function saveGroupNameAction(slug: string, formData: FormData): Promise<void> {
  const { user } = await requireMember(slug);
  const typed = String(formData.get("real_name") ?? "");
  const fallback = user.fullName || (user.username ? `@${user.username}` : "");
  await repo.setRealName(user.userId, repo.normalizeRealName(typed) || fallback);
  revalidatePath("/", "layout");
  redirect(await afterNamePath(slug, user.userId));
}

/**
 * Создание встречи.
 *
 * Поле `when` приходит либо из выбора времени как «2026-09-14T15:00|90», либо
 * свободным текстом. Точное время начала сохраняется только в первом случае:
 * разбирать произвольную фразу в дату — значит поставить напоминание не туда.
 */
export async function createMeetingAction(slug: string, formData: FormData): Promise<void> {
  const { chat, user } = await requireMember(slug);

  const place = String(formData.get("place") ?? "").trim();
  const goal = String(formData.get("goal") ?? "").trim();
  const when = String(formData.get("when") ?? "").trim();

  let whenStart: Date | null = null;
  let whenText = when;

  const bar = when.indexOf("|");
  if (bar >= 0) {
    const iso = when.slice(0, bar);
    const duration = when.slice(bar + 1);
    const [datePart, timePart = ""] = iso.split("T");
    const [hours, minutes] = timePart.split(":");
    const startMin = Number(hours) * 60 + Number(minutes ?? 0);
    if (isDateStr(datePart) && Number.isFinite(startMin)) {
      whenStart = zonedWallToUtc(datePart, startMin, chatTz(chat));
      const length = Number(duration) || 90;
      whenText =
        `${formatDay(chat.lang, datePart)} · ` +
        `${fmtMinutes(startMin)}–${fmtMinutes(startMin + length)}`;
    }
  }

  // Каждую неделю до выбранной даты — не дальше года и не раньше самой встречи.
  let repeatUntil: string | null = null;
  const rawUntil = String(formData.get("repeat_until") ?? "");
  if (whenStart && formData.get("repeat") === "on" && isDateStr(rawUntil)) {
    const first = utcToZonedWall(whenStart, chatTz(chat)).day;
    const limit = addDays(first, 366);
    if (rawUntil >= first) repeatUntil = rawUntil > limit ? limit : rawUntil;
  }

  const members = await repo.chatMembers(chat.chatId);
  const meeting = await repo.createMeeting({
    chatId: chat.chatId,
    initiatorId: user.userId,
    place: place.slice(0, 200),
    whenText: whenText.slice(0, 200),
    goal: goal.slice(0, 500),
    invitees: members.map((member) => member.userId),
    whenStart,
    repeatUntil: repeatUntil as DateStr | null,
  });
  // Организатор, очевидно, согласен со своей встречей.
  await repo.setResponse({ meetingId: meeting.id, userId: user.userId, answer: "yes" });

  const delivery = await notifyMeetingCreated(chat, meeting);
  back(slug, deliveryParams(delivery), `#meeting-${meeting.id}`);
}

export async function voteAction(
  slug: string,
  meetingId: number,
  formData: FormData,
): Promise<void> {
  const { chat, user } = await requireMember(slug);

  const answer = String(formData.get("answer") ?? "");
  if (answer !== "yes" && answer !== "maybe" && answer !== "no" && answer !== "change") back(slug);

  const meeting = await repo.getMeeting(meetingId);
  if (!meeting || meeting.chatId !== chat.chatId || meeting.status !== "open") back(slug);

  const comment = String(formData.get("comment") ?? "").trim().slice(0, 300);
  // «Предложить изменения» без текста бессмысленно: организатору нечего читать.
  if (answer === "change" && !comment) back(slug, { err: "empty_comment" }, `#meeting-${meetingId}`);

  await repo.setResponse({ meetingId, userId: user.userId, answer, comment });
  await notifyVote(chat, meeting, user, answer, comment);
  back(slug, {}, `#meeting-${meetingId}`);
}

/**
 * Сменить код группы. Старый код и ссылка на нём перестают работать, поэтому
 * возвращаемся уже на новый адрес.
 */
export async function changeCodeAction(slug: string): Promise<void> {
  const { chat } = await requireAdmin(slug);
  const next = await repo.regenerateSlug(chat.chatId);
  revalidatePath(`/g/${slug}`);
  revalidatePath("/", "layout");
  redirect(`/g/${next}?code=changed&at=members`);
}

/** Отменить встречу может организатор или администратор группы. */
export async function cancelMeetingAction(slug: string, meetingId: number): Promise<void> {
  const { chat, user } = await requireMember(slug);
  const meeting = await repo.getMeeting(meetingId);
  if (!meeting || meeting.chatId !== chat.chatId) back(slug);
  if (meeting.initiatorId !== user.userId && !(await isGroupAdmin(chat, user.userId))) {
    back(slug, { err: "not_admin" });
  }

  await repo.updateMeeting(meetingId, { status: "cancelled" });
  await repo.closeMeetingNotices(meetingId);
  // Карточка в Telegram-чате должна показать отмену — иначе туда продолжат голосовать.
  await notifyVote(chat, { ...meeting, status: "cancelled" }, user, "cancel", "");
  back(slug, {}, `#meeting-${meetingId}`);
}

/** Напомнить тем, кто ещё не ответил на встречу. */
export async function pingNonRespondersAction(slug: string, meetingId: number): Promise<void> {
  const { chat, user } = await requireMember(slug);
  const meeting = await repo.getMeeting(meetingId);
  if (!meeting || meeting.chatId !== chat.chatId || meeting.status !== "open") back(slug);
  if (meeting.initiatorId !== user.userId && !(await isGroupAdmin(chat, user.userId))) {
    back(slug, { err: "not_admin" });
  }
  if ((await repo.bumpCounter(`ping:${meetingId}`, REMIND_WINDOW_MS)) > 1) {
    back(slug, { err: "throttled" }, `#meeting-${meetingId}`);
  }

  const delivery = await notifyNonResponders(chat, meeting, user);
  back(slug, deliveryParams(delivery), `#meeting-${meetingId}`);
}

function hhmm(value: string, fallback: number): number {
  const match = /^(\d{1,2})(?::(\d{1,2}))?$/.exec(value.trim());
  if (!match) return fallback;
  const total = Number(match[1]) * 60 + Number(match[2] ?? 0);
  return total >= 0 && total <= 24 * 60 ? total : fallback;
}

export async function saveSettingsAction(slug: string, formData: FormData): Promise<void> {
  const { chat } = await requireAdmin(slug);

  const start = hhmm(String(formData.get("day_start") ?? ""), chat.dayStartMin);
  const end = hhmm(String(formData.get("day_end") ?? ""), chat.dayEndMin);
  const minSlot = Number(formData.get("min_slot") ?? chat.minSlotMin);
  const buffer = Number(formData.get("buffer") ?? chat.travelBufferMin);
  const semester = String(formData.get("semester") ?? "").trim();

  const patch: Parameters<typeof repo.updateChat>[1] = {
    minSlotMin: Math.max(15, Math.min(Number.isFinite(minSlot) ? minSlot : 30, 12 * 60)),
    travelBufferMin: Math.max(0, Math.min(Number.isFinite(buffer) ? buffer : 0, 120)),
    lang: normalizeLang(String(formData.get("lang") ?? chat.lang)),
    semesterStart: semester && isDateStr(semester) ? semester : null,
  };
  if (start < end) {
    patch.dayStartMin = start;
    patch.dayEndMin = end;
  }

  await repo.updateChat(chat.chatId, patch);
  back(slug, { saved: "settings" });
}

// --------------------------------------------------------------------------
// Администрирование участников
// --------------------------------------------------------------------------

/**
 * Попросить заполнить расписание: одного человека (`user_id`) или всех,
 * кто ещё не заполнил (без `user_id`).
 */
export async function remindFillAction(slug: string, formData: FormData): Promise<void> {
  const { chat, user } = await requireAdmin(slug);
  const rawTarget = String(formData.get("user_id") ?? "").trim();

  const members = await repo.chatMembers(chat.chatId);
  const updated = await repo.scheduleUpdatedAt(members.map((member) => member.userId));
  const cutoff = semesterCutoff(chat);
  // Напоминаем и тем, кто не заполнял, и тем, у кого расписание с прошлого семестра.
  let targets = members.filter(
    (member) =>
      member.userId !== user.userId &&
      (!updated.has(member.userId) || isOutdated(updated.get(member.userId), cutoff)),
  );
  if (rawTarget) {
    const targetId = Number(rawTarget);
    targets = targets.filter((member) => member.userId === targetId);
  }
  if (targets.length === 0) back(slug, { err: "nobody_to_remind" }, "#members");

  const fresh: User[] = [];
  for (const target of targets) {
    const count = await repo.bumpCounter(`remind:${chat.chatId}:${target.userId}`, REMIND_WINDOW_MS);
    if (count === 1) fresh.push(target);
  }
  if (fresh.length === 0) back(slug, { err: "throttled" }, "#members");

  const delivery = await notifyFillSchedule(chat, user, fresh);
  back(slug, deliveryParams(delivery), "#members");
}

/**
 * Начался новый семестр. Начало семестра становится сегодняшним днём: все
 * расписания, сохранённые раньше, помечаются устаревшими, а бот просит
 * каждого обновить своё. Сами расписания не удаляются — по ним считаем,
 * пока человек не обновит, это лучше пустой карты.
 */
export async function newSemesterAction(slug: string): Promise<void> {
  const { chat, user } = await requireAdmin(slug);
  const today = todayIn(chatTz(chat));
  await repo.updateChat(chat.chatId, { semesterStart: today });

  const members = await repo.chatMembers(chat.chatId);
  const fresh: User[] = [];
  for (const target of members) {
    if (target.userId === user.userId) continue;
    const count = await repo.bumpCounter(`remind:${chat.chatId}:${target.userId}`, REMIND_WINDOW_MS);
    if (count === 1) fresh.push(target);
  }
  const delivery = await notifyFillSchedule({ ...chat, semesterStart: today }, user, fresh, "semester");
  revalidatePath(`/g/${slug}`);
  back(slug, { ...deliveryParams(delivery), saved: "semester" }, "#members");
}

/** Назначить или снять администратора сайта. */
export async function setRoleAction(slug: string, formData: FormData): Promise<void> {
  const { chat, user } = await requireAdmin(slug);
  const targetId = Number(formData.get("user_id"));
  const role = String(formData.get("role") ?? "") === ROLE_ADMIN ? ROLE_ADMIN : ROLE_MEMBER;
  if (!Number.isFinite(targetId) || !(await repo.isMember(chat.chatId, targetId))) {
    back(slug, {}, "#members");
  }

  if (role === ROLE_MEMBER) {
    const source = await adminSource(chat, targetId);
    // Создателя и администраторов Telegram-чата сайт разжаловать не может:
    // первого — чтобы группа не осталась без хозяина, вторых назначает Telegram.
    if (source === "creator" || source === "telegram") back(slug, { err: "cannot_demote" }, "#members");
    // Группа не должна остаться совсем без администратора.
    const remaining = (await repo.adminIds(chat.chatId)).filter((id) => id !== targetId);
    if (
      remaining.length === 0 &&
      chat.createdBy === null &&
      (await telegramAdminIds(chat)).length === 0
    ) {
      back(slug, { err: "last_admin" }, "#members");
    }
  }

  await repo.setMemberRole(chat.chatId, targetId, role);
  back(slug, {}, "#members");
}

/** Убрать участника из группы. Его расписание остаётся — вернуться можно по ссылке. */
export async function removeMemberAction(slug: string, formData: FormData): Promise<void> {
  const { chat, user } = await requireAdmin(slug);
  const targetId = Number(formData.get("user_id"));
  if (!Number.isFinite(targetId) || targetId === user.userId) back(slug, {}, "#members");

  const source = await adminSource(chat, targetId);
  if (source === "creator" || source === "telegram") back(slug, { err: "cannot_remove" }, "#members");

  await repo.removeMembership(chat.chatId, targetId);
  back(slug, {}, "#members");
}

/** Закрыть баннер-уведомление. */
export async function dismissNoticeAction(slug: string, noticeId: number): Promise<void> {
  const { user } = await requireMember(slug);
  await repo.markNoticeRead(noticeId, user.userId);
  back(slug);
}
