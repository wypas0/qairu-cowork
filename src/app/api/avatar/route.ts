import type { NextRequest } from "next/server";

import { parseAvatarDataUrl } from "@/core/avatar";
import * as repo from "@/db/repo";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Загрузить своё фото профиля. Тело: {"image": "data:image/webp;base64,..."}. */
export async function POST(request: NextRequest) {
  const user = await currentUser();
  if (!user) return Response.json({ detail: "unauthorized" }, { status: 401 });

  // Не читаем в память тело больше, чем может занять допустимое фото.
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > 400 * 1024) return Response.json({ error: "too_large" }, { status: 413 });

  let body: { image?: unknown };
  try {
    body = (await request.json()) as { image?: unknown };
  } catch {
    return Response.json({ error: "format" }, { status: 400 });
  }

  const parsed = parseAvatarDataUrl(body.image);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: parsed.error === "too_large" ? 413 : 400 });
  }
  const version = await repo.setAvatar(user.userId, parsed.value);
  return Response.json({ ok: true, url: `/api/avatar/${user.userId}?v=${version}` });
}

/** Убрать своё фото профиля. */
export async function DELETE() {
  const user = await currentUser();
  if (!user) return Response.json({ detail: "unauthorized" }, { status: 401 });
  await repo.deleteAvatar(user.userId);
  return Response.json({ ok: true });
}
