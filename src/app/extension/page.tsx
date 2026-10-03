import { headers } from "next/headers";

import { Topbar } from "@/components/Topbar";
import { EXTENSION_ZIP, LATEST_EXTENSION } from "@/core/extensionImport";
import { normalizeLang, translator } from "@/i18n";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Расширение кампуса: архив и как его поставить. Пока расширения нет в
 * Chrome Web Store, ставится распакованным — отсюда же и обновляется.
 */
export default async function ExtensionPage() {
  const user = await currentUser();
  const lang = user?.lang ?? normalizeLang(((await headers()).get("accept-language") ?? "").split(",")[0]);
  const t = translator(lang);

  return (
    <>
      <Topbar lang={lang} />
      <main className="wrap">
        <div className="card ext-page">
          <h1 style={{ fontSize: 22 }}>{t("w_ext_title")}</h1>
          <p>{t("w_ext_lead")}</p>
          <a className="btn btn-primary" href={EXTENSION_ZIP} download>
            {t("w_ext_download", { v: LATEST_EXTENSION })}
          </a>

          <h2>{t("w_ext_install_title")}</h2>
          <ol>
            <li>{t("w_ext_install_1")}</li>
            <li>{t("w_ext_install_2")}</li>
            <li>{t("w_ext_install_3")}</li>
          </ol>

          <h2>{t("w_ext_use_title")}</h2>
          <ol>
            <li>{t("w_ext_use_1")}</li>
            <li>{t("w_ext_use_2")}</li>
            <li>{t("w_ext_use_3")}</li>
          </ol>

          <p className="small muted">{t("w_ext_update_how")}</p>
          <p className="small muted">{t("w_ext_privacy")}</p>
        </div>
      </main>
    </>
  );
}
