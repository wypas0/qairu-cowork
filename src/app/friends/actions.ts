"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import * as repo from "@/db/repo";
import type { User } from "@/db/schema";
import { safeNext } from "@/lib/auth";
import * as friends from "@/lib/friends";
import { requireTelegramUser } from "@/lib/gate";
import { isSameOriginPost } from "@/lib/secFetch";

/**
 * Действия раздела «Друзья». Каждое — только для вошедшего через Telegram и
 * только с нашей же страницы: кука сессии SameSite=None, и без проверки
 * источника чужая страница могла бы отправить заявку от имени человека.
 * Решает всё lib/friends; здесь — разбор формы и возврат с тостом (?fr=…).
 */

/** Куда вернуться: только страницы друзей, ссылок и групп. */
function backPath(formData: FormData, fallback = "/friends"): string {
  const next = safeNext(String(formData.get("next") ?? ""), fallback);
  return /^\/(friends(\/|\?|$)|f\/|g\/)/.test(next) ? next : fallback;
}

/** Путь с итогом действия для тоста. */
function withFlash(path: string, code: string): string {
  const url = new URL(path, "http://local");
  url.searchParams.set("fr", code);
  return `${url.pathname}${url.search}`;
}

function done(path: string, code: string): never {
  revalidatePath("/", "layout");
  redirect(withFlash(path, code));
}

async function actor(back: string): Promise<User> {
  const user = await requireTelegramUser(back);
  if (!isSameOriginPost(await headers())) redirect(withFlash(back, "origin"));
  return user;
}

function idOf(formData: FormData, name: string): number | null {
  const value = Number(formData.get(name));
  return Number.isSafeInteger(value) && value !== 0 ? value : null;
}

/** Заявка: по нику из поиска или «В друзья» у одногруппника. */
export async function requestFriendAction(formData: FormData): Promise<void> {
  const back = backPath(formData);
  const me = await actor(back);
  const member = idOf(formData, "member");
  const outcome =
    member !== null
      ? await friends.requestGroupmate(me, member)
      : await friends.requestByUsername(me, String(formData.get("username") ?? ""));
  done(back, outcome);
}

export async function answerRequestAction(formData: FormData): Promise<void> {
  const back = backPath(formData, "/friends?tab=requests");
  const me = await actor(back);
  const id = idOf(formData, "id");
  const accept = formData.get("accept") === "1";
  const outcome = id === null ? { code: "gone" as const } : await friends.answerFriendRequest(me, id, accept);
  done(back, outcome.code);
}

export async function cancelRequestAction(formData: FormData): Promise<void> {
  const back = backPath(formData, "/friends?tab=requests");
  const me = await actor(back);
  const id = idOf(formData, "id");
  done(back, id === null ? "gone" : await friends.cancelRequest(me, id));
}

export async function removeFriendAction(formData: FormData): Promise<void> {
  const me = await actor("/friends");
  const id = idOf(formData, "user_id");
  done("/friends", id === null ? "gone" : await friends.removeFriend(me, id));
}

export async function blockUserAction(formData: FormData): Promise<void> {
  const me = await actor("/friends");
  const id = idOf(formData, "user_id");
  done("/friends?tab=privacy", id === null ? "gone" : await friends.blockUser(me, id));
}

export async function unblockUserAction(formData: FormData): Promise<void> {
  const me = await actor("/friends?tab=privacy");
  const id = idOf(formData, "user_id");
  done("/friends?tab=privacy", id === null ? "gone" : await friends.unblockUser(me, id));
}

export async function rotateFriendCodeAction(): Promise<void> {
  const me = await actor("/friends?tab=add");
  done("/friends?tab=add", await friends.rotateFriendCode(me));
}

/** «Добавить в друзья» на странице чужой ссылки /f/<код>. */
export async function addByLinkAction(formData: FormData): Promise<void> {
  const code = String(formData.get("code") ?? "").slice(0, 32);
  const page = `/f/${encodeURIComponent(code)}`;
  const me = await actor(page);
  const outcome = await friends.addByLink(me, code);
  if (outcome.owner && (outcome.code === "friends_now" || outcome.code === "already")) {
    done(`/friends/${outcome.owner.userId}`, outcome.code);
  }
  done(page, outcome.code);
}

/** Приватность: что видят друзья, находят ли по нику, какие группы скрыты. */
export async function saveFriendSettingsAction(formData: FormData): Promise<void> {
  const me = await actor("/friends?tab=privacy");
  await repo.setFriendSettings(me.userId, {
    friendsSeeGroups: formData.get("friends_see_groups") === "on",
    friendsSeeFree: formData.get("friends_see_free") === "on",
    findable: formData.get("findable") === "on",
  });
  // Скрытие — только у своих групп: чужой chat_id из формы ничего не меняет.
  const hidden = new Set(formData.getAll("hidden").map(Number));
  for (const group of await repo.groupsOfUser(me.userId)) {
    const want = hidden.has(group.chatId);
    if (want !== group.hidden) await repo.setGroupHidden(group.chatId, me.userId, want);
  }
  done("/friends?tab=privacy", "saved");
}

/** Позвать друзей в группу — со страницы группы (галочки) или из карточки друга. */
export async function inviteFriendsAction(formData: FormData): Promise<void> {
  const back = backPath(formData);
  const me = await actor(back);
  const chatId = idOf(formData, "chat");
  const chat = chatId === null ? null : await repo.getChat(chatId);
  if (!chat) done(back, "gone");
  const ids = formData.getAll("friend").map(Number);
  const outcome = await friends.inviteFriends(me, chat, ids);
  done(back, outcome.code === "sent" ? (outcome.sent > 1 ? "invited_many" : "invited") : outcome.code);
}

/** Ответ на приглашение в группу или на просьбу вступить. */
export async function answerInviteAction(formData: FormData): Promise<void> {
  const back = backPath(formData, "/friends?tab=requests");
  const me = await actor(back);
  const id = idOf(formData, "id");
  const accept = formData.get("accept") === "1";
  const outcome = id === null ? { code: "gone" as const } : await friends.answerGroupInvite(me, id, accept);
  if (outcome.code === "joined" && outcome.chat?.slug) done(`/g/${outcome.chat.slug}`, "joined");
  done(back, outcome.code);
}

/** Попроситься в группу друга. */
export async function askToJoinAction(formData: FormData): Promise<void> {
  const back = backPath(formData);
  const me = await actor(back);
  const friendId = idOf(formData, "friend");
  const chatId = idOf(formData, "chat");
  done(back, friendId === null || chatId === null ? "gone" : await friends.askToJoin(me, friendId, chatId));
}
