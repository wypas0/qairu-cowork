import { cookies } from "next/headers";

import * as repo from "@/db/repo";
import { currentUser, safeNext, setTokenCookie } from "@/lib/auth";
import { LOGIN_COOKIE, completeLoginRequest } from "@/lib/tglogin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Опрос страницы «Войти через Telegram».
 *
 * Пока человек не нажал «Подтвердить» в боте — `pending`. После подтверждения
 * этот же запрос выдаёт сессию браузеру, у которого есть секрет из куки, и
 * возвращает, куда перейти.
 */
export async function GET() {
  const store = await cookies();
  const cookieValue = store.get(LOGIN_COOKIE)?.value ?? "";
  if (!cookieValue) return Response.json({ status: "invalid" });

  const result = await completeLoginRequest(cookieValue, await currentUser());
  if (result.status === "pending") return Response.json(result);

  store.delete(LOGIN_COOKIE);
  if (result.status !== "ok") return Response.json({ status: result.status });

  const token = await repo.issueWebSession(result.userId);
  await setTokenCookie(token);
  return Response.json({ status: "ok", next: safeNext(result.next), merged: result.merged });
}
