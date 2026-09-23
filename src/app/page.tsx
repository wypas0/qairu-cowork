import Link from "next/link";
import { headers } from "next/headers";

import { IconBell, IconChevronRight, IconPhone, IconUser } from "@/components/icons";
import { ProductDemo } from "@/components/ProductDemo";
import { OpenLastGroup } from "@/components/TelegramHome";
import { profilePanelProps } from "@/components/profilePanelProps";
import { TelegramSignIn } from "@/components/TelegramSignIn";
import { Topbar } from "@/components/Topbar";
import { displayName } from "@/db/schema";
import { LANG_NAMES, normalizeLang, translator } from "@/i18n";
import { pageUser } from "@/lib/gate";
import { createGroup, joinByCodeAction } from "./actions";

export const dynamic = "force-dynamic";

const TIMEZONES = [
  ["Asia/Almaty", "Asia/Almaty (UTC+5)"],
  ["Asia/Qyzylorda", "Asia/Qyzylorda (UTC+5)"],
  ["Asia/Aqtobe", "Asia/Aqtobe (UTC+5)"],
  ["Asia/Tashkent", "Asia/Tashkent (UTC+5)"],
  ["Europe/Moscow", "Europe/Moscow (UTC+3)"],
  ["UTC", "UTC"],
];

export default async function LandingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const requestHeaders = await headers();
  const user = await pageUser("/");
  const lang = user?.lang ?? normalizeLang((requestHeaders.get("accept-language") ?? "").split(",")[0]);
  const t = translator(lang);
  // Группы для страницы — те же, что в панели профиля: собираем их один раз.
  const panel = await profilePanelProps(lang);
  const groups = panel.groups;
  const joinError =
    query.join === "bad" ? "w_join_err_bad" : query.join === "notfound" ? "w_join_err_notfound" : null;

  return (
    <>
      <Topbar lang={lang} panel={panel} />
      {/* Группы уже отсортированы по свежести — первая и есть последняя открытая. */}
      <OpenLastGroup slug={groups[0]?.slug ?? null} />
      <main className="wrap">
        {user ? (
          /* Вернувшемуся рассказ о продукте не нужен — сразу его группы. */
          <header className="page-head">
            <div>
              <p className="eyebrow">{displayName(user)}</p>
              <h1>{groups.length > 0 ? t("w_my_groups") : t("w_home_start")}</h1>
              {groups.length === 0 && <p className="lead">{t("w_home_start_lead")}</p>}
            </div>
          </header>
        ) : (
          <>
          <section className="hero">
            <div className="hero-text">
              <h1 className="type-display">{t("w_hero_title")}</h1>
              <p className="lead">{t("w_hero_lead")}</p>
            </div>
            {/* Сразу показываем сам продукт, а не рассказ о нём. */}
            <ProductDemo lang={lang} />
          </section>

          {/* Как это работает — строки с волосяными линиями, без нумерованных плиток. */}
          <ol className="steps">
            {([1, 2, 3] as const).map((n) => (
              <li className="step" key={n}>
                <h3>{t(`w_step${n}_t`)}</h3>
                <p className="small muted">{t(`w_step${n}_d`)}</p>
              </li>
            ))}
          </ol>

          <section className="card tg-only" aria-labelledby="tg-only-title">
            <h2 id="tg-only-title">{t("w_tg_only_title")}</h2>
            <ul className="tg-only-list">
              <li>
                <IconUser size={20} className="ico" />
                <span>{t("w_tg_only_1")}</span>
              </li>
              <li>
                <IconPhone size={20} className="ico" />
                <span>{t("w_tg_only_2")}</span>
              </li>
              <li>
                <IconBell size={20} className="ico" />
                <span>{t("w_tg_only_3")}</span>
              </li>
            </ul>
          </section>
          </>
        )}

        {groups.length > 0 && (
          <ul className="group-list">
            {groups.map((group) => (
              <li key={group.chatId}>
                <Link className="group-row" href={`/g/${group.slug}`}>
                  <span className="group-mark" aria-hidden="true">
                    {group.title.trim()[0]?.toUpperCase() ?? "?"}
                  </span>
                  <span className="group-name">{group.title}</span>
                  {group.pending ? <span className="count-badge">{group.pending}</span> : null}
                  <IconChevronRight className="muted" />
                </Link>
              </li>
            ))}
          </ul>
        )}

        <div className="card" id="join" style={{ scrollMarginTop: 72 }}>
          <h2>{t("w_join_code_title")}</h2>
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

        <div className="card" id="create" style={{ scrollMarginTop: 72 }}>
          <h2>{t("w_create")}</h2>
          {user ? (
            <form action={createGroup}>
              <div className="field">
                <label htmlFor="title">{t("w_group_title")}</label>
                <input
                  id="title"
                  name="title"
                  type="text"
                  required
                  maxLength={120}
                  placeholder={t("w_group_title_ph")}
                />
              </div>
              <div className="row">
                <div className="field">
                  <label htmlFor="tz">{t("w_tz")}</label>
                  <select id="tz" name="tz" defaultValue="Asia/Almaty">
                    {TIMEZONES.map(([value, title]) => (
                      <option key={value} value={value}>
                        {title}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="lang">{t("w_lang")}</label>
                  <select id="lang" name="lang" defaultValue={lang}>
                    {Object.entries(LANG_NAMES).map(([code, title]) => (
                      <option key={code} value={code}>
                        {title}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <button className="btn btn-primary" type="submit">
                {t("w_create")}
              </button>
            </form>
          ) : (
            <div style={{ maxWidth: 420 }}>
              <p className="small muted">{t("w_create_login_lead")}</p>
              <TelegramSignIn lang={lang} next="/#create" />
              <p className="small muted" style={{ marginTop: 10 }}>
                {t("w_signin_hint")}
              </p>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
