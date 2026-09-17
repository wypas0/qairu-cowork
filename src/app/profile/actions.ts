"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import * as repo from "@/db/repo";
import { currentTelegramUser } from "@/lib/auth";
import { normalizeCode } from "@/lib/invite";

export type RealNameState = { status: "idle" | "saved" | "cleared" | "unauthorized" };

/** Сохранить настоящее имя из панели профиля. Пустое поле убирает его. */
export async function saveRealNameAction(
  _previous: RealNameState,
  formData: FormData,
): Promise<RealNameState> {
  const user = await currentTelegramUser();
  if (!user) return { status: "unauthorized" };
  const saved = await repo.setRealName(user.userId, String(formData.get("real_name") ?? ""));
  // Настоящее имя видно в шапке и в списке участников на любой странице.
  revalidatePath("/", "layout");
  return { status: saved ? "saved" : "cleared" };
}

/** Выйти из группы, не потеряв своё расписание — вернуться можно по той же ссылке-приглашению. */
export async function leaveGroupAction(slug: string): Promise<void> {
  const user = await currentTelegramUser();
  if (!user) return;
  const chat = await repo.getChatBySlug(slug);
  if (!chat) return;

  await repo.removeMembership(chat.chatId, user.userId);
  // Затрагивает шапку (список групп в профиле) на любой странице сайта.
  revalidatePath("/", "layout");
}

export async function joinByLinkAction(formData: FormData): Promise<void> {
  const slug = normalizeCode(String(formData.get("link") ?? ""));
  redirect(slug ? `/g/${slug}/join` : "/?join=bad#join");
}
