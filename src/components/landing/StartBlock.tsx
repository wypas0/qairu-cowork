import { joinByCodeAction } from "@/app/actions";
import { IconBell, IconPhone, IconUser } from "@/components/icons";
import { TelegramSignIn } from "@/components/TelegramSignIn";
import { translator } from "@/i18n";

/**
 * Л6. Старт — только у гостя: вторая панель с небом. Слева «Создать группу»
 * (сначала вход через Telegram, потом окно по /#create), справа — вход в
 * группу по коду. Якоря #create и #join и ошибка кода (?join=…) — как раньше.
 * Вошедшему блок не нужен: группы и поле кода у него в сайдбаре.
 */
export function StartBlock({ lang, joinError }: { lang: string; joinError: string | null }) {
  const t = translator(lang);
  return (
    <section className="start sky-panel" aria-labelledby="start-title">
      <h2 id="start-title" className="start-title display-caps">
        {t("w_l_start_title")
          .split("|")
          .map((line) => (
            <span key={line}>{line}</span>
          ))}
      </h2>
      <div className="start-cols">
        <div className="start-col" id="create">
          <h3>{t("w_create")}</h3>
          <p className="small muted">{t("w_create_login_lead")}</p>
          <TelegramSignIn lang={lang} next="/#create" />
          <p className="small muted start-hint">{t("w_signin_hint")}</p>
        </div>
        <div className="start-col" id="join">
          <h3>{t("w_join_code_title")}</h3>
          <p className="small muted">{t("w_join_code_lead")}</p>
          {joinError && (
            <div className="notice warn" role="alert">
              {t(joinError)}
            </div>
          )}
          <form action={joinByCodeAction} className="row join-code">
            <input
              type="text"
              name="code"
              required
              maxLength={40}
              autoComplete="off"
              spellCheck={false}
              placeholder={t("w_join_code_ph")}
              aria-label={t("w_join_code_title")}
            />
            <button className="btn" type="submit">
              {t("w_join_code_btn")}
            </button>
          </form>
        </div>
      </div>
      <div className="start-tg">
        <p className="eyebrow">{t("w_tg_only_title")}</p>
        <ul className="tg-only-list small">
          <li>
            <IconUser size={18} className="ico" />
            <span>{t("w_tg_only_1")}</span>
          </li>
          <li>
            <IconPhone size={18} className="ico" />
            <span>{t("w_tg_only_2")}</span>
          </li>
          <li>
            <IconBell size={18} className="ico" />
            <span>{t("w_tg_only_3")}</span>
          </li>
        </ul>
      </div>
    </section>
  );
}
