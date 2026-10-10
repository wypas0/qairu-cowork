import { headers } from "next/headers";

import { CopyButton } from "@/components/CopyButton";
import { ExtensionStatus } from "@/components/ExtensionStatus";
import { Topbar } from "@/components/Topbar";
import {
  EXTENSION_FOLDER,
  EXTENSION_ZIP,
  EXTENSION_ZIP_NAME,
  LATEST_EXTENSION,
} from "@/core/extensionImport";
import { normalizeLang, translator } from "@/i18n";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const EXTENSIONS_URL = "chrome://extensions";

/**
 * Расширение кампуса: короткий гайд в духе README — шапка со скачиванием и
 * живой проверкой «стоит ли и какой версии», шаги установки сеткой, ниже в две
 * колонки: как пользоваться и обновлять | частые проблемы и приватность.
 * Пока расширения нет в Chrome Web Store, оно ставится распакованным.
 */
export default async function ExtensionPage() {
  const user = await currentUser();
  const lang = user?.lang ?? normalizeLang(((await headers()).get("accept-language") ?? "").split(",")[0]);
  const t = translator(lang);
  const names = { zip: EXTENSION_ZIP_NAME, folder: EXTENSION_FOLDER };

  const steps: { title: string; text: string; extra?: React.ReactNode }[] = [
    { title: t("w_ext_step1_title"), text: t("w_ext_step1", names) },
    { title: t("w_ext_step2_title"), text: t("w_ext_step2", names) },
    {
      title: t("w_ext_step3_title"),
      text: t("w_ext_step3"),
      extra: (
        <div className="ext-copy">
          <code>{EXTENSIONS_URL}</code>
          <CopyButton value={EXTENSIONS_URL} label={t("w_ext_copy")} copiedLabel={t("w_ext_copied")} small />
        </div>
      ),
    },
    { title: t("w_ext_step4_title"), text: t("w_ext_step4") },
    { title: t("w_ext_step5_title", names), text: t("w_ext_step5") },
    { title: t("w_ext_step6_title"), text: t("w_ext_step6") },
  ];

  const faq = [1, 2, 3, 4, 5, 6].map((n) => [t(`w_ext_faq_q${n}`), t(`w_ext_faq_a${n}`)] as const);

  return (
    <>
      <Topbar lang={lang} />
      <main className="wrap">
        <article className="ext-guide">
          <header className="card ext-hero">
            <div className="ext-hero-text">
              <p className="eyebrow">{t("w_ext_eyebrow")}</p>
              <h1>{t("w_ext_title")}</h1>
              <p className="lead">{t("w_ext_lead")}</p>
            </div>
            <div className="ext-hero-actions">
              <a className="btn btn-primary" href={EXTENSION_ZIP} download={EXTENSION_ZIP_NAME}>
                {t("w_ext_download", { v: LATEST_EXTENSION })}
              </a>
              <ExtensionStatus
                lang={lang}
                labels={{
                  checking: t("w_ext_status_checking"),
                  ok: t("w_ext_status_ok", { v: "{v}" }),
                  old: t("w_ext_status_old", { v: "{v}", latest: "{latest}" }),
                  none: t("w_ext_status_none"),
                  unsupported: t("w_ext_status_unsupported"),
                }}
              />
              <p className="small muted ext-meta">{t("w_ext_meta")}</p>
            </div>
          </header>

          <section id="install" className="card ext-section">
            <h2>{t("w_ext_install_title")}</h2>
            <ol className="ext-steps">
              {steps.map((step) => (
                <li key={step.title}>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                  {step.extra}
                </li>
              ))}
            </ol>
            <p className="notice ext-check">{t("w_ext_install_check")}</p>
          </section>

          <div className="ext-cols">
            <div className="ext-col">
              <section id="use" className="card ext-section">
                <h2>{t("w_ext_use_title")}</h2>
                <ol className="ext-numbered">
                  <li>{t("w_ext_use_1")}</li>
                  <li>{t("w_ext_use_2")}</li>
                  <li>{t("w_ext_use_3")}</li>
                </ol>
                <p className="small muted">{t("w_ext_use_manual")}</p>
              </section>

              <section id="update" className="card ext-section">
                <h2>{t("w_ext_update_title")}</h2>
                <ol className="ext-numbered">
                  <li>{t("w_ext_update_1", names)}</li>
                  <li>{t("w_ext_update_2")}</li>
                </ol>
                <p className="small muted">{t("w_ext_update_note")}</p>
              </section>
            </div>

            <div className="ext-col">
              <section id="faq" className="card ext-section">
                <h2>{t("w_ext_faq_title")}</h2>
                <div className="ext-faq">
                  {faq.map(([question, answer]) => (
                    <details key={question}>
                      <summary>{question}</summary>
                      <p>{answer}</p>
                    </details>
                  ))}
                </div>
              </section>

              <section id="privacy" className="card ext-section">
                <h2>{t("w_ext_privacy_title")}</h2>
                <ul className="ext-list">
                  <li>{t("w_ext_privacy_1")}</li>
                  <li>{t("w_ext_privacy_2")}</li>
                  <li>{t("w_ext_privacy_3")}</li>
                </ul>
              </section>
            </div>
          </div>
        </article>
      </main>
    </>
  );
}
