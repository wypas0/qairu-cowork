"use server";

import { redirect } from "next/navigation";

import { tzOf } from "@/core/timeutils";
import * as repo from "@/db/repo";
import { ROLE_ADMIN } from "@/db/schema";
import { normalizeLang } from "@/i18n";
import { currentUser, setTokenCookie } from "@/lib/auth";

/** Создание группы прямо на сайте — без Telegram и без регистрации. Создатель — её администратор. */
export async function createGroup(formData: FormData): Promise<void> {
  const title = String(formData.get("title") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const tz = tzOf(String(formData.get("tz") ?? ""));
  const lang = normalizeLang(String(formData.get("lang") ?? ""));

  const existing = await currentUser();
  if (!title || (!name && !existing)) redirect("/");

  const { slug, token } = await repo.transaction(async (tx) => {
    const chat = await repo.createWebChat({ title, tz, lang }, tx);
    // Уже вошедший человек создаёт группу от своего имени, а не заводит двойника.
    const user = existing ?? (await repo.createWebUser({ fullName: name, lang }, tx));
    await repo.updateChat(chat.chatId, { createdBy: user.userId }, tx);
    await repo.addMembership(chat.chatId, user.userId, tx, ROLE_ADMIN);
    if (existing) return { slug: chat.slug!, token: null };
    const issued = await repo.issueWebSession(user.userId, tx);
    return { slug: chat.slug!, token: issued };
  });

  if (token) await setTokenCookie(token);
  redirect(`/g/${slug}/me`);
}
