"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import * as repo from "@/db/repo";
import { currentUser } from "@/lib/auth";

/** Выйти из группы, не потеряв своё расписание — вернуться можно по той же ссылке-приглашению. */
export async function leaveGroupAction(slug: string): Promise<void> {
  const user = await currentUser();
  if (!user) return;
  const chat = await repo.getChatBySlug(slug);
  if (!chat) return;

  await repo.removeMembership(chat.chatId, user.userId);
  // Затрагивает шапку (список групп в профиле) на любой странице сайта.
  revalidatePath("/", "layout");
}

/** Достать слаг из полной ссылки-приглашения или принять его как есть. */
function extractSlug(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const match = /\/g\/([a-z0-9]{3,24})/i.exec(trimmed);
  const candidate = (match ? match[1] : trimmed).toLowerCase();
  return /^[a-z0-9]{3,24}$/.test(candidate) ? candidate : null;
}

export async function joinByLinkAction(formData: FormData): Promise<void> {
  const slug = extractSlug(String(formData.get("link") ?? ""));
  redirect(slug ? `/g/${slug}/join` : "/");
}
