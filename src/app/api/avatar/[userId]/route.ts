import * as repo from "@/db/repo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Отдать фото профиля.
 *
 * Адрес всегда содержит `?v=<время обновления>`, поэтому ответ можно кэшировать
 * навсегда: новое фото — новый адрес. `nosniff` и CSP запрещают браузеру
 * трактовать ответ как что-либо, кроме картинки.
 */
export async function GET(_request: Request, context: { params: Promise<{ userId: string }> }) {
  const { userId } = await context.params;
  if (!/^-?\d{1,20}$/.test(userId)) return new Response(null, { status: 404 });

  const avatar = await repo.getAvatar(Number(userId));
  if (!avatar) return new Response(null, { status: 404 });

  return new Response(new Uint8Array(avatar.data), {
    headers: {
      "Content-Type": avatar.mime,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
