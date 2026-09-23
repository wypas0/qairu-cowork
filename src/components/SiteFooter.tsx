import { t } from "@/i18n";
import { CONTACTS, telegramUrl } from "@/lib/contacts";
import { BrandMark, IconGlobe, IconSend } from "./icons";
import { InstallApp } from "./InstallApp";

/**
 * Подвал: что это за сайт, кому писать о баге и чей это проект.
 *
 * На страницах группы он стоит в основной колонке — рядом с сайдбаром, а не
 * под ним: иначе его текст уезжал под левую панель. На остальных страницах
 * его рисует общий layout.
 */
export function SiteFooter({ lang }: { lang: string }) {
  const hubSite = CONTACTS.hub.site.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return (
    <footer className="foot">
      <div className="foot-inner">
        <div className="foot-about">
          <span className="foot-brand">
            <BrandMark size={16} className="brand-mark" />
            <span>
              Qairu<b>Cowork</b>
            </span>
          </span>
          <span>{t(lang, "w_footer")}</span>
          <InstallApp label={t(lang, "w_install_app")} />
        </div>
        <div className="foot-contacts">
          {CONTACTS.developerTelegram && (
            <p className="foot-contact">
              <span>{t(lang, "w_contact_dev")}</span>
              <a href={telegramUrl(CONTACTS.developerTelegram)} target="_blank" rel="noopener noreferrer">
                <IconSend size={14} />@{CONTACTS.developerTelegram.replace(/^@/, "")}
              </a>
            </p>
          )}
          {(CONTACTS.hub.site || CONTACTS.hub.telegram) && (
            <p className="foot-contact">
              <span>{t(lang, "w_contact_hub")}</span>
              {CONTACTS.hub.site && (
                <a href={CONTACTS.hub.site} target="_blank" rel="noopener noreferrer">
                  <IconGlobe size={14} />
                  {hubSite}
                </a>
              )}
              {CONTACTS.hub.telegram && (
                <a href={telegramUrl(CONTACTS.hub.telegram)} target="_blank" rel="noopener noreferrer">
                  <IconSend size={14} />@{CONTACTS.hub.telegram.replace(/^@/, "")}
                </a>
              )}
            </p>
          )}
        </div>
      </div>
    </footer>
  );
}
