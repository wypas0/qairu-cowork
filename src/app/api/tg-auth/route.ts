import type { NextRequest } from "next/server";

import * as repo from "@/db/repo";
import { normalizeLang } from "@/i18n";
import { InitDataError, setTokenCookie, verifyInitData } from "@/lib/auth";
import { botToken } from "@/lib/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Вход из Telegram Mini App: подписанный initData → тот же самый пользователь бота. */
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
  const slug = body.slug ?? "";

  const token = await repo.transaction(async (tx) => {
    await repo.upsertUser(
      {
        userId,
        username: tgUser.username ?? null,
        fullName: fullName || String(userId),
        lang: normalizeLang(tgUser.language_code),
      },
      tx,
    );
    if (slug) {
      const chat = await repo.getChatBySlug(slug, tx);
      if (chat) await repo.addMembership(chat.chatId, userId, tx);
    }
    return repo.issueWebSession(userId, tx);
  });

  await setTokenCookie(token);
  return Response.json({ ok: true });
}
