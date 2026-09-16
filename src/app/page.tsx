import Link from "next/link";
import { headers } from "next/headers";

import { IconBell, IconPhone, IconUser } from "@/components/icons";
import { TelegramSignIn } from "@/components/TelegramSignIn";
import { Topbar } from "@/components/Topbar";
import * as repo from "@/db/repo";
import { LANG_NAMES, normalizeLang, translator } from "@/i18n";
import { pageUser } from "@/lib/gate";
import { createGroup } from "./actions";

export const dynamic = "force-dynamic";

const TIMEZONES = [
  ["Asia/Almaty", "Asia/Almaty (UTC+5)"],
  ["Asia/Qyzylorda", "Asia/Qyzylorda (UTC+5)"],
  ["Asia/Aqtobe", "Asia/Aqtobe (UTC+5)"],
  ["Asia/Tashkent", "Asia/Tashkent (UTC+5)"],
  ["Europe/Moscow", "Europe/Moscow (UTC+3)"],
  ["UTC", "UTC"],
];

export default async function LandingPage() {
  const requestHeaders = await headers();
  const user = await pageUser("/");
  const lang = user?.lang ?? normalizeLang((requestHeaders.get("accept-language") ?? "").split(",")[0]);
  const t = translator(lang);
  const groups = user ? await repo.userChats(user.userId) : [];

  return (
    <>
      <Topbar />
      <main className="wrap">
        <section className="hero">
          <h1 className="type-display">{t("w_hero_title")}</h1>
          <p className="lead">{t("w_hero_lead")}</p>
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

        {groups.length > 0 && (
          <div className="card">
            <h2>{t("w_my_groups")}</h2>
            <ul className="people">
              {groups.map((group) => (
                <li key={group.chatId}>
                  <Link className="chip ok" href={`/g/${group.slug}`}>
                    {group.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

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
