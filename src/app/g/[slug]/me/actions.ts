"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { parseDatedBusy } from "@/core/dated";
import { chatTz, todayIn } from "@/core/timeutils";
import * as repo from "@/db/repo";
import { currentUser } from "@/lib/auth";
import { normalizeCalendarUrl, syncCalendar } from "@/lib/calendarSync";
import { checkConflictsQuietly } from "@/lib/conflicts";
import { connectUrl } from "@/lib/gate";

async function requireMember(slug: string) {
  const chat = await repo.getChatBySlug(slug);
  if (!chat) redirect("/");
  const user = await currentUser();
  if (user?.isWeb) redirect(connectUrl(`/g/${slug}/me`));
  if (!user || !(await repo.isMember(chat.chatId, user.userId))) redirect(`/g/${slug}/join`);
  return { chat, user };
}

/** Добавить разовую занятость: одну дату или период, весь день или часы. */
export async function addDatedBusyAction(slug: string, formData: FormData): Promise<void> {
  const { chat, user } = await requireMember(slug);

  const parsed = parseDatedBusy(
    {
      dateFrom: String(formData.get("date_from") ?? ""),
      dateTo: String(formData.get("date_to") ?? ""),
      allDay: formData.get("all_day") === "on",
      start: String(formData.get("start") ?? ""),
      end: String(formData.get("end") ?? ""),
      label: String(formData.get("label") ?? ""),
    },
    todayIn(chatTz(chat)),
  );
  if (!parsed.ok) redirect(`/g/${slug}/me?err=${parsed.error}&at=dated`);

  const { dateFrom, dateTo, start, end, label } = parsed.value;
  if (dateTo) {
    await repo.addRangeSlot({ userId: user.userId, dateFrom, dateTo, start, end, label, kind: "other" });
  } else {
    await repo.addDatedSlot({ userId: user.userId, day: dateFrom, start, end, label, kind: "other" });
  }
  after(() => checkConflictsQuietly(user.userId));

  revalidatePath(`/g/${slug}`);
  revalidatePath(`/g/${slug}/me`);
  redirect(`/g/${slug}/me?added=1&at=dated`);
}

export async function deleteDatedBusyAction(slug: string, slotId: number): Promise<void> {
  const { user } = await requireMember(slug);
  await repo.deleteSlot(user.userId, slotId);
  revalidatePath(`/g/${slug}`);
  revalidatePath(`/g/${slug}/me`);
  redirect(`/g/${slug}/me?at=dated`);
}

/** Подключить календарь по ссылке и сразу его загрузить. */
export async function saveCalendarAction(slug: string, formData: FormData): Promise<void> {
  const { user } = await requireMember(slug);
  const url = normalizeCalendarUrl(String(formData.get("calendar_url") ?? ""));
  if (!url) redirect(`/g/${slug}/me?cal=bad_url&at=calendar`);
  await repo.setCalendarUrl(user.userId, url);
  const result = await syncCalendar(user.userId, url);
  if (result.ok) after(() => checkConflictsQuietly(user.userId));
  revalidatePath(`/g/${slug}`);
  revalidatePath(`/g/${slug}/me`);
  redirect(`/g/${slug}/me?cal=${result.ok ? "ok" : result.error}&at=calendar`);
}

/** Загрузить календарь заново, не дожидаясь cron. */
export async function refreshCalendarAction(slug: string): Promise<void> {
  const { user } = await requireMember(slug);
  const url = (await repo.getUser(user.userId))?.calendarUrl;
  if (!url) redirect(`/g/${slug}/me?at=calendar`);
  const result = await syncCalendar(user.userId, url);
  if (result.ok) after(() => checkConflictsQuietly(user.userId));
  revalidatePath(`/g/${slug}`);
  revalidatePath(`/g/${slug}/me`);
  redirect(`/g/${slug}/me?cal=${result.ok ? "ok" : result.error}&at=calendar`);
}

/** Отключить календарь: занятость из него пропадает. */
export async function removeCalendarAction(slug: string): Promise<void> {
  const { user } = await requireMember(slug);
  await repo.setCalendarUrl(user.userId, null);
  revalidatePath(`/g/${slug}`);
  revalidatePath(`/g/${slug}/me`);
  redirect(`/g/${slug}/me?cal=removed&at=calendar`);
}
