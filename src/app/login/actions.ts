"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import * as repo from "@/db/repo";
import { checkCurrentPassword, registerLoginAttempt, resetLoginAttempts } from "@/lib/account";
import { clearSession, currentToken, currentUser, safeNext, setTokenCookie } from "@/lib/auth";
import { hasBot } from "@/lib/config";
import { hashPassword, normalizeLogin, validateCredentials, verifyPassword } from "@/lib/password";
import { LOGIN_COOKIE, LOGIN_REQUEST_TTL_MS, createLoginRequest } from "@/lib/tglogin";

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

  // Попытка засчитывается до проверки пароля — см. registerLoginAttempt.
  if (!(await registerLoginAttempt(login, await clientIp()))) {
    redirect(loginUrl({ err: "throttled", next }));
  }

  const found = await repo.credentialsForLogin(input);
  const ok = await verifyPassword(password, found?.credentials.passwordHash ?? DUMMY_HASH);
  if (!found || !ok) redirect(loginUrl({ err: "invalid", next }));

  await resetLoginAttempts(login);
  const token = await repo.issueWebSession(found.user.userId);
  await setTokenCookie(token);
  revalidatePath("/", "layout");
  redirect(next);
}

/** Не больше стольких запросов входа через Telegram с одного адреса за 15 минут. */
const MAX_TG_LOGIN_STARTS = 20;

/**
 * «Войти через Telegram»: создать одноразовый запрос, секрет положить в куку
 * этого браузера и перейти на страницу ожидания со ссылкой на бота.
 */
export async function startTelegramLoginAction(formData: FormData): Promise<void> {
  const next = safeNext(String(formData.get("next") ?? ""));
  if (!hasBot()) redirect(loginUrl({ err: "no_bot", next }));

  const ip = await clientIp();
  if ((await repo.bumpCounter(`tgloginip:${ip}`, 15 * 60 * 1000)) > MAX_TG_LOGIN_STARTS) {
    redirect(loginUrl({ err: "throttled", next }));
  }

  const requestHeaders = await headers();
  const { code, secret } = await createLoginRequest({
    next,
    mergeFrom: await currentUser(),
    userAgent: requestHeaders.get("user-agent") ?? "",
  });
  const store = await cookies();
  store.set(LOGIN_COOKIE, `${code}.${secret}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.ceil(LOGIN_REQUEST_TTL_MS / 1000) + 60,
  });
  redirect("/login/telegram");
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

  // Если пароль уже есть, менять его может только тот, кто знает текущий:
  // иначе хватило бы на минуту оставленного открытым браузера.
  const check = await checkCurrentPassword(user.userId, String(formData.get("current") ?? ""));
  if (check === "throttled") redirect("/account?err=throttled");
  if (check === "wrong") redirect("/account?err=current_wrong");
  const hadCredentials = check === "ok";

  const login = normalizeLogin(input.login);
  if (await repo.loginTaken(login, user.userId)) redirect("/account?err=login_taken");

  await repo.setCredentials({
    userId: user.userId,
    login,
    passwordHash: await hashPassword(input.password),
  });
  // Старый пароль мог быть известен кому-то ещё — его сессии больше не действуют.
  if (hadCredentials) await repo.deleteOtherWebSessions(user.userId, await currentToken());

  redirect("/account?saved=1");
}

/**
 * Отключить вход по паролю. Требует текущий пароль — так же, как его смена:
 * без этого отключение было бы обходом защиты смены пароля.
 */
export async function deleteCredentialsAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) redirect("/login");

  const check = await checkCurrentPassword(user.userId, String(formData.get("current") ?? ""));
  if (check === "throttled") redirect("/account?err=throttled");
  if (check === "wrong") redirect("/account?err=current_wrong");
  if (check === "no_credentials") redirect("/account");

  await repo.deleteCredentials(user.userId);
  // Кто-то мог знать пароль и войти им — после отключения эти входы не должны жить.
  await repo.deleteOtherWebSessions(user.userId, await currentToken());
  redirect("/account?removed=1");
}
