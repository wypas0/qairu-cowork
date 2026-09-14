"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import * as repo from "@/db/repo";
import { clearSession, currentToken, currentUser, safeNext, setTokenCookie } from "@/lib/auth";
import { hashPassword, normalizeLogin, validateCredentials, verifyPassword } from "@/lib/password";

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
/** Попыток на один логин за окно: достаточно, чтобы ошибиться, мало для перебора. */
const MAX_PER_LOGIN = 8;
/** Попыток с одного адреса за окно — против перебора по многим логинам. */
const MAX_PER_IP = 40;

// Проверяем пароль и для несуществующего логина: по времени ответа нельзя
// понять, существует ли такой аккаунт.
const DUMMY_HASH =
  "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

async function clientIp(): Promise<string> {
  const requestHeaders = await headers();
  const forwarded = requestHeaders.get("x-forwarded-for") ?? "";
  return forwarded.split(",")[0].trim() || requestHeaders.get("x-real-ip") || "unknown";
}

function loginUrl(params: Record<string, string>): string {
  return `/login?${new URLSearchParams(params).toString()}`;
}

export async function loginAction(formData: FormData): Promise<void> {
  const input = String(formData.get("login") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = safeNext(String(formData.get("next") ?? ""));
  const login = normalizeLogin(input);
  if (!login || !password) redirect(loginUrl({ err: "empty", next }));

  const loginKey = `login:${login}`;
  const ipKey = `loginip:${await clientIp()}`;
  if (
    (await repo.peekCounter(loginKey, LOGIN_WINDOW_MS)) >= MAX_PER_LOGIN ||
    (await repo.peekCounter(ipKey, LOGIN_WINDOW_MS)) >= MAX_PER_IP
  ) {
    redirect(loginUrl({ err: "throttled", next }));
  }

  const found = await repo.credentialsForLogin(input);
  const ok = await verifyPassword(password, found?.credentials.passwordHash ?? DUMMY_HASH);
  if (!found || !ok) {
    await repo.bumpCounter(loginKey, LOGIN_WINDOW_MS);
    await repo.bumpCounter(ipKey, LOGIN_WINDOW_MS);
    redirect(loginUrl({ err: "invalid", next }));
  }

  await repo.deleteBotState(loginKey);
  const token = await repo.issueWebSession(found.user.userId);
  await setTokenCookie(token);
  revalidatePath("/", "layout");
  redirect(next);
}

export async function logoutAction(): Promise<void> {
  await clearSession();
  revalidatePath("/", "layout");
  redirect("/");
}

/** Задать или сменить логин и пароль текущему пользователю. */
export async function saveCredentialsAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) redirect(loginUrl({ next: "/account" }));

  const input = {
    login: String(formData.get("login") ?? ""),
    password: String(formData.get("password") ?? ""),
    confirm: String(formData.get("confirm") ?? ""),
  };
  const problem = validateCredentials(input);
  if (problem) redirect(`/account?err=${problem}`);

  const existing = await repo.getCredentials(user.userId);
  if (existing) {
    // Сменить пароль может только тот, кто знает текущий: иначе хватило бы
    // на минуту оставленного открытым браузера.
    const current = String(formData.get("current") ?? "");
    const attempts = await repo.peekCounter(`acct:${user.userId}`, LOGIN_WINDOW_MS);
    if (attempts >= MAX_PER_LOGIN) redirect("/account?err=throttled");
    if (!(await verifyPassword(current, existing.passwordHash))) {
      await repo.bumpCounter(`acct:${user.userId}`, LOGIN_WINDOW_MS);
      redirect("/account?err=current_wrong");
    }
  }

  const login = normalizeLogin(input.login);
  if (await repo.loginTaken(login, user.userId)) redirect("/account?err=login_taken");

  await repo.setCredentials({
    userId: user.userId,
    login,
    passwordHash: await hashPassword(input.password),
  });
  // Старый пароль мог быть известен кому-то ещё — его сессии больше не действуют.
  if (existing) await repo.deleteOtherWebSessions(user.userId, await currentToken());

  redirect("/account?saved=1");
}

export async function deleteCredentialsAction(): Promise<void> {
  const user = await currentUser();
  if (!user) redirect("/login");
  await repo.deleteCredentials(user.userId);
  redirect("/account?removed=1");
}
