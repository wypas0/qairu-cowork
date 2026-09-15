import Link from "next/link";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { botUsername } from "@/bot/context";
import { TelegramLoginWaiter } from "@/components/TelegramLoginWaiter";
import { Topbar } from "@/components/Topbar";
import { normalizeLang, translator } from "@/i18n";
import { currentUser } from "@/lib/auth";
import { hasBot } from "@/lib/config";
import { LOGIN_COOKIE, LOGIN_LINK_PREFIX, loginRequestPurpose } from "@/lib/tglogin";

export const dynamic = "force-dynamic";

export default async function TelegramLoginPage() {
  const store = await cookies();
  const cookieValue = store.get(LOGIN_COOKIE)?.value ?? "";
  const code = cookieValue.split(".")[0];
  if (!code || !hasBot()) redirect("/login");

  const requestHeaders = await headers();
  const user = await currentUser();
  const lang = user?.lang ?? normalizeLang((requestHeaders.get("accept-language") ?? "").split(",")[0]);
  const t = translator(lang);

  const linking = (await loginRequestPurpose(code)) === "link";
  const username = await botUsername();
  const deepLink = `https://t.me/${username}?start=${LOGIN_LINK_PREFIX}${code}`;

  return (
    <>
      <Topbar lang={lang} />
      <main className="wrap">
        <div className="card" style={{ maxWidth: 440, margin: "32px auto" }}>
          <h1 style={{ fontSize: 22 }}>{t(linking ? "w_tglink_title" : "w_tglogin_title")}</h1>
          {linking && <p className="small muted">{t("w_tglink_lead")}</p>}
          <ol className="tglogin-steps small">
            <li>{t("w_tglogin_step1")}</li>
            <li>{t("w_tglogin_step2")}</li>
            <li>{t("w_tglogin_step3")}</li>
          </ol>

          <a
            className="btn btn-primary tg-btn"
            href={deepLink}
            target="_blank"
            rel="noopener noreferrer"
            style={{ width: "100%" }}
          >
            {t("w_tglogin_open_bot")}
          </a>

          <TelegramLoginWaiter
            labels={{
              waiting: t("w_tglogin_waiting"),
              done: t(linking ? "w_tglink_done" : "w_tglogin_done"),
              rejected: t("w_tglogin_rejected"),
              expired: t("w_tglogin_expired"),
              invalid: t("w_tglogin_invalid"),
              retry: t("w_tglogin_retry"),
            }}
          />

          {user?.isWeb && !linking && <p className="small muted">{t("w_tglogin_merge_hint")}</p>}

          <Link className="small" href="/login">
            {t("w_tglogin_back")}
          </Link>
        </div>
      </main>
    </>
  );
}
