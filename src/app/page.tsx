import Link from "next/link";
import { headers } from "next/headers";

import { Topbar } from "@/components/Topbar";
import * as repo from "@/db/repo";
import { LANG_NAMES, normalizeLang, translator } from "@/i18n";
import { currentUser } from "@/lib/auth";
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
  const user = await currentUser();
  const lang = user?.lang ?? normalizeLang((requestHeaders.get("accept-language") ?? "").split(",")[0]);
  const t = translator(lang);
  const groups = user ? await repo.userChats(user.userId) : [];

  return (
    <>
      <Topbar />
      <main className="wrap">
        <section className="hero">
          <h1>{t("w_hero_title")}</h1>
          <p className="lead">{t("w_hero_lead")}</p>
        </section>

        <div className="steps">
          {([1, 2, 3] as const).map((n) => (
            <div className="step" key={n}>
              <div className="n">{n}</div>
              <h3>{t(`w_step${n}_t`)}</h3>
              <p className="small muted">{t(`w_step${n}_d`)}</p>
            </div>
          ))}
        </div>

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

        <div className="card">
          <h2>{t("w_create")}</h2>
          <form action={createGroup}>
            <div className="row">
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
              {/* Вошедший создаёт группу от своего имени — второй раз представляться не нужно. */}
              {!user && (
                <div className="field">
                  <label htmlFor="name">{t("w_your_name")}</label>
                  <input
                    id="name"
                    name="name"
                    type="text"
                    required
                    maxLength={60}
                    placeholder={t("w_your_name_ph")}
                  />
                </div>
              )}
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
        </div>
      </main>
    </>
  );
}
