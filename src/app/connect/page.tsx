import { redirect } from "next/navigation";

import { TelegramSignIn } from "@/components/TelegramSignIn";
import { Topbar } from "@/components/Topbar";
import { displayName } from "@/db/schema";
import { translator } from "@/i18n";
import { currentUser, safeNext } from "@/lib/auth";
import { logoutAction } from "../login/actions";

export const dynamic = "force-dynamic";

/**
 * Экран для старых аккаунтов, заведённых на сайте без Telegram. Дальше сайт
 * не пускает, пока Telegram не подключён: подключение переносит группы и
 * расписание в Telegram-аккаунт.
 */
export default async function ConnectTelegramPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const next = safeNext(typeof query.next === "string" ? query.next : "");
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (!user.isWeb) redirect(next);

  const t = translator(user.lang);

  return (
    <>
      <Topbar lang={user.lang} />
      <main className="wrap">
        <div className="card" style={{ maxWidth: 460, margin: "32px auto" }}>
          <h1 style={{ fontSize: 22 }}>{t("w_connect_title")}</h1>
          <p>{t("w_connect_lead", { name: displayName(user) })}</p>
          <p className="small muted">{t("w_connect_why")}</p>

          <TelegramSignIn lang={user.lang} next={next} purpose="link" label={t("w_connect_btn")} />

          <form action={logoutAction} style={{ marginTop: 14 }}>
            <button type="submit" className="btn btn-sm btn-quiet">
              {t("w_connect_other")}
            </button>
          </form>
        </div>
      </main>
    </>
  );
}
