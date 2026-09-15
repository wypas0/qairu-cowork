import Link from "next/link";
import { headers } from "next/headers";

import { TelegramSignIn } from "@/components/TelegramSignIn";
import { Topbar } from "@/components/Topbar";
import { displayName } from "@/db/schema";
import { normalizeLang, translator } from "@/i18n";
import { currentUser, safeNext } from "@/lib/auth";
import { loginAction, logoutAction } from "./actions";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  empty: "w_login_err_empty",
  invalid: "w_login_err_invalid",
  throttled: "w_login_err_throttled",
  no_bot: "w_tglogin_no_bot",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const requestHeaders = await headers();
  const user = await currentUser();
  const lang = user?.lang ?? normalizeLang((requestHeaders.get("accept-language") ?? "").split(",")[0]);
  const t = translator(lang);

  const next = safeNext(typeof query.next === "string" ? query.next : "");
  const errorKey = typeof query.err === "string" ? ERRORS[query.err] : undefined;

  return (
    <>
      <Topbar lang={lang} />
      <main className="wrap">
        <div className="card" style={{ maxWidth: 440, margin: "32px auto" }}>
          <h1 style={{ fontSize: 22 }}>{t("w_login_title")}</h1>

          {user && (
            <div className="notice" role="status">
              {t("w_login_already", { name: displayName(user) })}{" "}
              <form action={logoutAction} style={{ display: "inline" }}>
                <button className="btn btn-sm btn-quiet" type="submit">
                  {t("w_logout")}
                </button>
              </form>
            </div>
          )}

          {errorKey && (
            <div className="notice warn" role="alert">
              {t(errorKey)}
            </div>
          )}

          <TelegramSignIn lang={lang} next={next} />
          <p className="small muted" style={{ marginTop: 8 }}>
            {t("w_tglogin_lead")}
          </p>

          {/* Пароль — только для тех, кто уже задал его себе в профиле; зарегистрироваться им нельзя. */}
          <details className="login-password" open={Boolean(errorKey && errorKey !== "w_tglogin_no_bot")}>
            <summary className="small">{t("w_login_password_toggle")}</summary>
            <p className="small muted">{t("w_login_lead")}</p>

            <form action={loginAction}>
              <input type="hidden" name="next" value={next} />
              <div className="field">
                <label htmlFor="login">{t("w_login_field")}</label>
                <input
                  id="login"
                  name="login"
                  type="text"
                  required
                  maxLength={64}
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder={t("w_login_field_ph")}
                />
              </div>
              <div className="field">
                <label htmlFor="password">{t("w_password")}</label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  required
                  maxLength={128}
                  autoComplete="current-password"
                />
              </div>
              <button className="btn" type="submit" style={{ width: "100%" }}>
                {t("w_login_btn")}
              </button>
            </form>
          </details>

          <p className="small muted" style={{ marginTop: 14 }}>
            {t("w_login_no_account")}
          </p>
          <Link className="small" href="/">
            {t("w_home")}
          </Link>
        </div>
      </main>
    </>
  );
}
