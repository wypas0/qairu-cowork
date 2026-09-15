import type { NextRequest } from "next/server";

import { parseAvatarDataUrl } from "@/core/avatar";
import { MAX_PHOTOS, PHOTO_MAX_BYTES, VISION_PROMPT, parseVisionSlots } from "@/core/photoSchedule";
import * as repo from "@/db/repo";
import { currentUser } from "@/lib/auth";
import { VisionError, askVision, hasVision } from "@/lib/vision";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** Сколько распознаваний за сутки на человека: запрос платный, лимит страхует бюджет. */
const DAILY_LIMIT = 15;

/**
 * Распознать расписание со скриншотов. Тело: {"images": ["data:image/jpeg;base64,...", ...]}.
 * Ответ того же вида, что у текстового импорта: пары раскрашивают сетку, но не
 * сохраняются, пока человек сам не нажмёт «Сохранить».
 */
export async function POST(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const chat = await repo.getChatBySlug(slug);
  if (!chat) return Response.json({ detail: "not found" }, { status: 404 });

  const user = await currentUser();
  if (!user || !(await repo.isMember(chat.chatId, user.userId))) {
    return Response.json({ detail: "not a member" }, { status: 403 });
  }
  if (!hasVision()) return Response.json({ ok: false, error: "not_configured" }, { status: 503 });

  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_PHOTOS * PHOTO_MAX_BYTES * 1.4) {
    return Response.json({ ok: false, error: "too_large" }, { status: 413 });
  }

  let payload: { images?: unknown };
  try {
    payload = (await request.json()) as { images?: unknown };
  } catch {
    return Response.json({ ok: false, error: "format" }, { status: 400 });
  }
  const raw = Array.isArray(payload.images) ? payload.images : [];
  if (raw.length === 0) return Response.json({ ok: false, error: "empty" }, { status: 400 });
  if (raw.length > MAX_PHOTOS) return Response.json({ ok: false, error: "too_many" }, { status: 400 });

  const images: string[] = [];
  for (const item of raw) {
    // Тип проверяется по содержимому: в нейросеть уходит только настоящая картинка.
    const parsed = parseAvatarDataUrl(item, PHOTO_MAX_BYTES);
    if (!parsed.ok) {
      return Response.json({ ok: false, error: parsed.error }, { status: parsed.error === "too_large" ? 413 : 400 });
    }
    images.push(`data:${parsed.value.mime};base64,${parsed.value.base64}`);
  }

  if ((await repo.bumpCounter(`photoimport:${user.userId}`, 24 * 60 * 60 * 1000)) > DAILY_LIMIT) {
    return Response.json({ ok: false, error: "limit" }, { status: 429 });
  }

  let content: string;
  try {
    content = await askVision(VISION_PROMPT, images);
  } catch (error) {
    const kind = error instanceof VisionError ? error.kind : "upstream";
    console.error("import-photo:", kind, (error as Error).message);
    const status = kind === "timeout" ? 504 : kind === "rate_limited" ? 429 : 502;
    return Response.json({ ok: false, error: kind === "rate_limited" ? "busy" : "upstream" }, { status });
  }

  const slots = parseVisionSlots(content);
  return Response.json({ ok: slots.length > 0, slots, errors: [] });
}
