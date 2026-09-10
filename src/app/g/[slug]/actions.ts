"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { fmtMinutes } from "@/core/intervals";
import { chatTz, isDateStr, zonedWallToUtc } from "@/core/timeutils";
import * as repo from "@/db/repo";
import { formatDay, normalizeLang } from "@/i18n";
import { currentUser, setTokenCookie } from "@/lib/auth";

async function requireChat(slug: string) {
  const chat = await repo.getChatBySlug(slug);
  if (!chat) redirect("/");
  return chat;
}

/** Вход по ссылке-приглашению: человек только называет себя. */
export async function joinGroup(slug: string, formData: FormData): Promise<void> {
  const chat = await requireChat(slug);
  const name = String(formData.get("name") ?? "").trim();
  if (!name) redirect(`/g/${slug}/join`);

  const existing = await currentUser();
  let token: string | null = null;

  await repo.transaction(async (tx) => {
    let userId: number;
    if (existing) {
      await repo.renameUser(existing.userId, name, tx);
      userId = existing.userId;
    } else {
      const created = await repo.createWebUser({ fullName: name, lang: chat.lang }, tx);
      userId = created.userId;
      token = await repo.issueWebSession(userId, tx);
    }
    await repo.addMembership(chat.chatId, userId, tx);
  });

  if (token) await setTokenCookie(token);
  redirect(`/g/${slug}/me`);
}

/**
 * Создание встречи.
 *
 * Поле `when` приходит либо из сетки как «2026-09-14T15:00|90», либо свободным
 * текстом. Точное время начала сохраняется только в первом случае: разбирать
 * произвольную фразу в дату — значит поставить напоминание не туда.
 */
export async function createMeetingAction(slug: string, formData: FormData): Promise<void> {
  const chat = await requireChat(slug);
  const user = await currentUser();
  if (!user || !(await repo.isMember(chat.chatId, user.userId))) redirect(`/g/${slug}/join`);

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

  const members = await repo.chatMembers(chat.chatId);
  await repo.createMeeting({
    chatId: chat.chatId,
    initiatorId: user.userId,
    place: place.slice(0, 200),
    whenText: whenText.slice(0, 200),
    goal: goal.slice(0, 500),
    invitees: members.map((member) => member.userId),
    whenStart,
  });

  revalidatePath(`/g/${slug}`);
  redirect(`/g/${slug}`);
}

export async function voteAction(
  slug: string,
  meetingId: number,
  formData: FormData,
): Promise<void> {
  const chat = await requireChat(slug);
  const user = await currentUser();
  if (!user || !(await repo.isMember(chat.chatId, user.userId))) redirect(`/g/${slug}/join`);

  const answer = String(formData.get("answer") ?? "");
  if (answer !== "yes" && answer !== "no" && answer !== "change") redirect(`/g/${slug}`);

  const meeting = await repo.getMeeting(meetingId);
  if (!meeting || meeting.chatId !== chat.chatId) redirect(`/g/${slug}`);

  await repo.setResponse({
    meetingId,
    userId: user.userId,
    answer,
    comment: String(formData.get("comment") ?? "").trim().slice(0, 300),
  });

  revalidatePath(`/g/${slug}`);
  redirect(`/g/${slug}`);
}

export async function cancelMeetingAction(slug: string, meetingId: number): Promise<void> {
  const chat = await requireChat(slug);
  const user = await currentUser();
  const meeting = await repo.getMeeting(meetingId);
  if (!meeting || meeting.chatId !== chat.chatId) redirect(`/g/${slug}`);
  // Отменить встречу может только тот, кто её создал.
  if (!user || meeting.initiatorId !== user.userId) redirect(`/g/${slug}`);

  await repo.updateMeeting(meetingId, { status: "cancelled" });
  revalidatePath(`/g/${slug}`);
  redirect(`/g/${slug}`);
}

function hhmm(value: string, fallback: number): number {
  const match = /^(\d{1,2})(?::(\d{1,2}))?$/.exec(value.trim());
  if (!match) return fallback;
  const total = Number(match[1]) * 60 + Number(match[2] ?? 0);
  return total >= 0 && total <= 24 * 60 ? total : fallback;
}

export async function saveSettingsAction(slug: string, formData: FormData): Promise<void> {
  const chat = await requireChat(slug);
  const user = await currentUser();
  if (!user || !(await repo.isMember(chat.chatId, user.userId))) redirect(`/g/${slug}/join`);

  const start = hhmm(String(formData.get("day_start") ?? ""), chat.dayStartMin);
  const end = hhmm(String(formData.get("day_end") ?? ""), chat.dayEndMin);
  const minSlot = Number(formData.get("min_slot") ?? chat.minSlotMin);
  const buffer = Number(formData.get("buffer") ?? chat.travelBufferMin);
  const semester = String(formData.get("semester") ?? "").trim();

  const patch: Parameters<typeof repo.updateChat>[1] = {
    minSlotMin: Math.max(5, Math.min(Number.isFinite(minSlot) ? minSlot : 30, 12 * 60)),
    travelBufferMin: Math.max(0, Math.min(Number.isFinite(buffer) ? buffer : 0, 120)),
    lang: normalizeLang(String(formData.get("lang") ?? chat.lang)),
    semesterStart: semester && isDateStr(semester) ? semester : null,
  };
  if (start < end) {
    patch.dayStartMin = start;
    patch.dayEndMin = end;
  }

  await repo.updateChat(chat.chatId, patch);
  revalidatePath(`/g/${slug}`);
  redirect(`/g/${slug}`);
}
