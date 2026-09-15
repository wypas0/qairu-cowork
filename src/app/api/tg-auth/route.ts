import type { NextRequest } from "next/server";

import * as repo from "@/db/repo";
import { normalizeLang } from "@/i18n";
import { InitDataError, currentUser, setTokenCookie, verifyInitData } from "@/lib/auth";
import { botToken } from "@/lib/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Вход из Telegram Mini App: подписанный initData → тот же самый пользователь бота.
 *
 * Ответ `changed` говорит странице, изменилось ли что-то (новый вход, новая
 * группа, перенесённый аккаунт) и нужно ли перерисоваться.
 */
export async function POST(request: NextRequest) {
  let body: { initData?: string; slug?: string };
  try {
    body = (await request.json()) as { initData?: string; slug?: string };
  } catch {
    return Response.json({ detail: "bad request" }, { status: 400 });
  }

  let data;
  try {
    data = verifyInitData(body.initData ?? "", botToken());
  } catch (error) {
    const detail = error instanceof InitDataError ? error.message : "unauthorized";
    return Response.json({ detail }, { status: 401 });
  }

  const tgUser = data.user;
  if (!tgUser?.id) {
    return Response.json({ detail: "в initData нет пользователя" }, { status: 401 });
  }

  const userId = Number(tgUser.id);
  const fullName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ");
  const slug = typeof body.slug === "string" ? body.slug.slice(0, 32) : "";
  const current = await currentUser();

  await repo.upsertUser({
    userId,
    username: tgUser.username ?? null,
    fullName: fullName || String(userId),
    lang: normalizeLang(tgUser.language_code),
  });

  // В этом браузере был вошедший аккаунт с сайта — это тот же человек:
  // он открыл сайт из своего Telegram. Переносим его группы и расписание.
  const merged = current?.isWeb ? await repo.mergeWebUserIntoTelegram(current.userId, userId) : false;

  let joined = false;
  if (slug) {
    const chat = await repo.getChatBySlug(slug);
    if (chat) joined = await repo.addMembership(chat.chatId, userId);
  }

  const sameSession = current?.userId === userId;
  if (!sameSession) await setTokenCookie(await repo.issueWebSession(userId));

  return Response.json({ ok: true, changed: !sameSession || merged || joined });
}
