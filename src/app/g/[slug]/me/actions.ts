"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { parseDatedBusy } from "@/core/dated";
import { chatTz, todayIn } from "@/core/timeutils";
import * as repo from "@/db/repo";
import { currentUser } from "@/lib/auth";
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
