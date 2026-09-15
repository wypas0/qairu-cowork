import type { NextRequest } from "next/server";

import { MAX_PHOTOS, VISION_PROMPT, parseVisionResult } from "@/core/photoSchedule";
import * as repo from "@/db/repo";
import { currentTelegramUser } from "@/lib/auth";
import { FILE_MAX_BYTES, type PreparedFile, prepareScheduleFile } from "@/lib/scheduleFile";
import { VisionError, askVision, hasVision } from "@/lib/vision";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** Сколько распознаваний за сутки на человека: запрос платный, лимит страхует бюджет. */
const DAILY_LIMIT = 15;

/**
 * Распознать расписание из файлов: скриншот, PDF, HTML, Word, Excel, текст.
 * Тело — multipart/form-data с полями `files` (до 2 файлов по 1 МБ).
 *
 * Ответ того же вида, что у текстового импорта: пары раскрашивают сетку, но не
 * сохраняются, пока человек сам не нажмёт «Сохранить».
 */
export async function POST(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const chat = await repo.getChatBySlug(slug);
  if (!chat) return Response.json({ detail: "not found" }, { status: 404 });

  const user = await currentTelegramUser();
  if (!user || !(await repo.isMember(chat.chatId, user.userId))) {
    return Response.json({ detail: "not a member" }, { status: 403 });
  }
  if (!hasVision()) return Response.json({ ok: false, error: "not_configured" }, { status: 503 });

  // Не читаем в память тело больше, чем могут занять два допустимых файла.
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_PHOTOS * FILE_MAX_BYTES + 64 * 1024) {
    return Response.json({ ok: false, error: "too_large" }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ ok: false, error: "format" }, { status: 400 });
  }
  const uploads = form.getAll("files").filter((item): item is File => item instanceof File);
  if (uploads.length === 0) return Response.json({ ok: false, error: "empty" }, { status: 400 });
  if (uploads.length > MAX_PHOTOS) return Response.json({ ok: false, error: "too_many" }, { status: 400 });

  const files: PreparedFile[] = [];
  for (const [index, upload] of uploads.entries()) {
    if (upload.size > FILE_MAX_BYTES) {
      return Response.json({ ok: false, error: "too_large", file: index + 1 }, { status: 413 });
    }
    const prepared = prepareScheduleFile(upload.name, new Uint8Array(await upload.arrayBuffer()));
    if (!prepared.ok) {
      const status = prepared.error === "too_large" ? 413 : 400;
      return Response.json({ ok: false, error: prepared.error, file: index + 1 }, { status });
    }
    files.push(prepared.file);
  }

  if ((await repo.bumpCounter(`photoimport:${user.userId}`, 24 * 60 * 60 * 1000)) > DAILY_LIMIT) {
    return Response.json({ ok: false, error: "limit" }, { status: 429 });
  }

  let content: string;
  try {
    content = await askVision(VISION_PROMPT, files);
  } catch (error) {
    const kind = error instanceof VisionError ? error.kind : "upstream";
    console.error("import-photo:", kind, (error as Error).message);
    const status = kind === "timeout" ? 504 : kind === "rate_limited" ? 429 : 502;
    return Response.json({ ok: false, error: kind === "rate_limited" ? "busy" : "upstream" }, { status });
  }

  const result = parseVisionResult(content, files.length);
  // Хотя бы один файл — не расписание: не раскрашиваем сетку наполовину,
  // а говорим, какой заменить.
  if (result.notTimetable.length > 0) {
    return Response.json(
      { ok: false, error: "not_timetable", screenshots: result.notTimetable, total: files.length },
      { status: 422 },
    );
  }
  if (result.slots.length === 0) {
    return Response.json({ ok: false, error: "no_classes" }, { status: 422 });
  }
  return Response.json({ ok: true, slots: result.slots, errors: [] });
}
