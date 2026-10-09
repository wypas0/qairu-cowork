"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { endAllOwnerSessions, endOwnerSession, requestOwnerCode, verifyOwnerCode } from "@/lib/ownerConsole";
import {
  clearOwnerCookie,
  clientInfo,
  currentOwnerSession,
  ownerConsoleToken,
  ownerViewer,
  setOwnerCookie,
} from "@/lib/ownerGate";
import { safeOwnerPath } from "@/lib/ownerQuery";
import { isSameOriginPost } from "@/lib/secFetch";

/**
 * Действия консоли владельца. Каждое заново проверяет, что запрос пришёл с
 * нашей страницы (не только встроенной проверкой Next) и что это владелец.
 * Чужому — переход на /admin, где он получит «не найдено».
 */
async function owner() {
  if (!isSameOriginPost(await headers())) redirect("/admin");
  const viewer = await ownerViewer();
  if (!viewer) redirect("/admin");
  return viewer;
}

/**
 * Итог — параметром в адресе: страница покажет его тостом и уберёт из адреса.
 * Вернуться — на ту вкладку консоли, откуда пришла форма (поле `next`), но
 * только на свой адрес /admin…: чужой хост или протокол не пройдут.
 */
function back(formData: FormData | undefined, params: Record<string, string>): never {
  const path = safeOwnerPath(formData?.get("next"));
  redirect(`${path}?${new URLSearchParams(params).toString()}`);
}

export async function requestOwnerCodeAction(formData?: FormData): Promise<void> {
  const viewer = await owner();
  const result = await requestOwnerCode(viewer.user, await clientInfo());
  back(formData, result === "sent" ? { sent: "1" } : { err: result });
}

export async function verifyOwnerCodeAction(formData: FormData): Promise<void> {
  const viewer = await owner();
  const result = await verifyOwnerCode(
    viewer.user,
    String(formData.get("code") ?? "").slice(0, 32),
    viewer.webToken,
    await clientInfo(),
  );
  if (result.status === "ok") {
    await setOwnerCookie(result.token);
    back(formData, { in: "1" });
  }
  back(formData, result.status === "wrong" ? { err: "wrong", left: String(result.left) } : { err: result.status });
}

export async function logoutOwnerAction(formData?: FormData): Promise<void> {
  const viewer = await owner();
  await endOwnerSession(viewer.user.userId, await ownerConsoleToken(), await clientInfo());
  await clearOwnerCookie();
  back(formData, { out: "1" });
}

/** Только из открытой консоли: иначе любой, кто сидит на сайте под владельцем, выкинул бы его. */
export async function logoutAllOwnerAction(formData?: FormData): Promise<void> {
  const viewer = await owner();
  if (!(await currentOwnerSession(viewer))) redirect("/admin");
  await endAllOwnerSessions(viewer.user.userId, viewer.webToken, await clientInfo());
  await clearOwnerCookie();
  back(formData, { out: "all" });
}
