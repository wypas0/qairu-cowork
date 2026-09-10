"use server";

import { redirect } from "next/navigation";

import { tzOf } from "@/core/timeutils";
import * as repo from "@/db/repo";
import { normalizeLang } from "@/i18n";
import { setTokenCookie } from "@/lib/auth";

/** Создание группы прямо на сайте — без Telegram и без регистрации. */
export async function createGroup(formData: FormData): Promise<void> {
  const title = String(formData.get("title") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const tz = tzOf(String(formData.get("tz") ?? ""));
  const lang = normalizeLang(String(formData.get("lang") ?? ""));

  if (!title || !name) redirect("/");

  const { slug, token } = await repo.transaction(async (tx) => {
    const chat = await repo.createWebChat({ title, tz, lang }, tx);
    const user = await repo.createWebUser({ fullName: name, lang }, tx);
    await repo.addMembership(chat.chatId, user.userId, tx);
    const issued = await repo.issueWebSession(user.userId, tx);
    return { slug: chat.slug!, token: issued };
  });

  await setTokenCookie(token);
  redirect(`/g/${slug}/me`);
}
