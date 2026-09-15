"use server";

import { redirect } from "next/navigation";

import { tzOf } from "@/core/timeutils";
import * as repo from "@/db/repo";
import { ROLE_ADMIN } from "@/db/schema";
import { normalizeLang } from "@/i18n";
import { requireTelegramUser } from "@/lib/gate";

/** Создание группы на сайте. Только для вошедших через Telegram; создатель — администратор группы. */
export async function createGroup(formData: FormData): Promise<void> {
  const title = String(formData.get("title") ?? "").trim();
  const tz = tzOf(String(formData.get("tz") ?? ""));
  const lang = normalizeLang(String(formData.get("lang") ?? ""));

  const user = await requireTelegramUser("/#create");
  if (!title) redirect("/#create");

  const slug = await repo.transaction(async (tx) => {
    const chat = await repo.createWebChat({ title, tz, lang }, tx);
    await repo.updateChat(chat.chatId, { createdBy: user.userId }, tx);
    await repo.addMembership(chat.chatId, user.userId, tx, ROLE_ADMIN);
    return chat.slug!;
  });

  redirect(`/g/${slug}/me`);
}
