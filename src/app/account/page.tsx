import { redirect } from "next/navigation";

import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { Topbar } from "@/components/Topbar";
import * as repo from "@/db/repo";
import { displayName } from "@/db/schema";
import { translator } from "@/i18n";
import { pageUser } from "@/lib/gate";
import { PASSWORD_MIN } from "@/lib/password";
import { deleteCredentialsAction, logoutAction, saveCredentialsAction } from "../login/actions";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  login_format: "w_acct_err_login_format",
  login_taken: "w_acct_err_login_taken",
  password_short: "w_acct_err_password_short",
  password_long: "w_acct_err_password_long",
  password_mismatch: "w_acct_err_password_mismatch",
  current_wrong: "w_acct_err_current_wrong",
  throttled: "w_login_err_throttled",
};

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const user = await pageUser("/account");
  if (!user) redirect("/login?next=/account");

  const t = translator(user.lang);
  const credentials = await repo.getCredentials(user.userId);
  const telegramLogin = !user.isWeb && user.username ? user.username : null;

  const errorKey = typeof query.err === "string" ? ERRORS[query.err] : undefined;
  const saved = query.saved === "1";
  const removed = query.removed === "1";

  return (
    <>
      <Topbar lang={user.lang} />
      <main className="wrap">
        <div className="card" style={{ maxWidth: 520, margin: "32px auto" }}>
          <h1 style={{ fontSize: 22 }}>{t("w_acct_title")}</h1>
          <p className="muted">{displayName(user)}</p>

          {errorKey && (
            <div className="notice warn" role="alert">
              {t(errorKey, { min: PASSWORD_MIN })}
            </div>
          )}
          {saved && (
            <div className="notice" role="status">
              {t("w_acct_saved")}
            </div>
          )}
          {removed && (
            <div className="notice" role="status">
              {t("w_acct_removed")}
            </div>
          )}

          <table className="acct-table">
            <tbody>
              <tr>
                <th scope="row">{t("w_acct_login")}</th>
                <td className="mono">{credentials?.login ?? "—"}</td>
              </tr>
              <tr>
                <th scope="row">{t("w_acct_tg_login")}</th>
                <td>
                  <span className="mono">{telegramLogin ? `@${telegramLogin}` : "—"}</span>
                  {!telegramLogin && <div className="small muted">{t("w_acct_tg_hint")}</div>}
                </td>
              </tr>
              <tr>
                <th scope="row">{t("w_password")}</th>
                <td>{credentials ? t("w_acct_password_set") : t("w_acct_password_unset")}</td>
              </tr>
            </tbody>
          </table>

          <h2 style={{ marginTop: 20 }}>
            {credentials ? t("w_acct_change_title") : t("w_acct_set_title")}
          </h2>
          <p className="small muted">{t("w_acct_set_lead")}</p>

          <form action={saveCredentialsAction}>
            <div className="field">
              <label htmlFor="login">{t("w_acct_login")}</label>
              <input
                id="login"
                name="login"
                type="text"
                required
                minLength={3}
                maxLength={32}
                pattern="[A-Za-z0-9][A-Za-z0-9_.\-]{2,31}"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                defaultValue={credentials?.login ?? telegramLogin?.toLowerCase() ?? ""}
              />
              <p className="small muted" style={{ marginTop: 5 }}>
                {t("w_acct_login_hint")}
              </p>
            </div>
            {credentials && (
              <div className="field">
                <label htmlFor="current">{t("w_acct_current")}</label>
                <input
                  id="current"
                  name="current"
                  type="password"
                  required
                  autoComplete="current-password"
                />
              </div>
            )}
            <div className="row">
              <div className="field">
                <label htmlFor="password">{t("w_acct_new_password")}</label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  required
                  minLength={PASSWORD_MIN}
                  maxLength={128}
                  autoComplete="new-password"
                />
              </div>
              <div className="field">
                <label htmlFor="confirm">{t("w_acct_confirm")}</label>
                <input
                  id="confirm"
                  name="confirm"
                  type="password"
                  required
                  minLength={PASSWORD_MIN}
                  maxLength={128}
                  autoComplete="new-password"
                />
              </div>
            </div>
            <p className="small muted" style={{ marginTop: -6 }}>
              {t("w_acct_password_hint", { min: PASSWORD_MIN })}
            </p>
            <button className="btn btn-primary" type="submit">
              {t("w_acct_save")}
            </button>
          </form>

          {credentials && (
            <form action={deleteCredentialsAction} className="remove-credentials">
              <h2 style={{ marginTop: 24 }}>{t("w_acct_remove")}</h2>
              <p className="small muted">{t("w_acct_remove_lead")}</p>
              <div className="change-form">
                <input
                  name="current"
                  type="password"
                  required
                  autoComplete="current-password"
                  placeholder={t("w_acct_current")}
                  aria-label={t("w_acct_current")}
                />
                <ConfirmSubmit
                  className="btn btn-sm btn-quiet btn-danger"
                  confirm={t("w_acct_remove_confirm")}
                >
                  {t("w_acct_remove")}
                </ConfirmSubmit>
              </div>
            </form>
          )}

          <div className="votes" style={{ marginTop: 20 }}>
            <form action={logoutAction}>
              <button className="btn btn-sm" type="submit">
                {t("w_logout")}
              </button>
            </form>
          </div>
          {!credentials && user.isWeb && (
            <p className="small muted" style={{ marginTop: 10 }}>
              {t("w_acct_logout_warning")}
            </p>
          )}
        </div>
      </main>
    </>
  );
}
