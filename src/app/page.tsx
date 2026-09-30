import { headers } from "next/headers";

import { CreateGroupDialog } from "@/components/CreateGroupDialog";
import { IconBell, IconPhone, IconPlus, IconUser } from "@/components/icons";
import { GroupsButton, LandingShell } from "@/components/LandingShell";
import { ProductDemo } from "@/components/ProductDemo";
import { ProfilePanel } from "@/components/ProfilePanel";
import { GroupLink, GroupMeetings, type MeetingLabels } from "@/components/SidebarGroups";
import { SiteFooter } from "@/components/SiteFooter";
import { OpenLastGroup } from "@/components/TelegramHome";
import { profilePanelProps } from "@/components/profilePanelProps";
import { TelegramSignIn } from "@/components/TelegramSignIn";
import { Topbar } from "@/components/Topbar";
import { LANG_NAMES, normalizeLang, tn, translator } from "@/i18n";
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

/** Заголовок с одним акцентным словом рукописным шрифтом. */
function withAccent(title: string, accent: string) {
  const at = accent ? title.indexOf(accent) : -1;
  if (at < 0) return title;
  return (
    <>
      {title.slice(0, at)}
      <i className="script-word">{accent}</i>
      {title.slice(at + accent.length)}
    </>
  );
}

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

  // Витрина одна для всех: гость узнаёт о продукте, вошедший возвращается к
  // ней логотипом. Свои группы у вошедшего — в сайдбаре, а не на странице.
  const showcase = (
    <>
      {/* Небо витрины — самый крупный элемент первого экрана (LCP). Фоновую
          картинку браузер находит только после разбора CSS; ссылка в разметке
          отдаёт её сразу и с высоким приоритетом. */}
      <link rel="preload" as="image" href="/hero-sky.jpg" fetchPriority="high" />
      <section className="hero">
        <div className="hero-text">
          <h1 className="type-display">{withAccent(t("w_hero_title"), t("w_hero_accent"))}</h1>
          <p className="lead">{t("w_hero_lead")}</p>
        </div>
        {/* Сразу показываем сам продукт, а не рассказ о нём. */}
        <ProductDemo lang={lang} />
      </section>

      <p className="manifest display-caps" aria-hidden="true">
        {t("w_manifest")
          .split("|")
          .map((line) => (
            <span key={line}>{line}</span>
          ))}
      </p>

      {/* Как это работает — три шага с крупным номером. */}
      <ol className="steps">
        {([1, 2, 3] as const).map((n) => (
          <li className="step" key={n}>
            <span className="step-n display-caps" aria-hidden="true">
              0{n}
            </span>
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
  );

  if (!user) {
    return (
      <>
        <Topbar lang={lang} panel={panel} />
        {/* Мини-апп, открытый приглашением, ведёт в эту группу. */}
        <OpenLastGroup slug={null} />
        <main className="wrap">
          {showcase}

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
            <div style={{ maxWidth: 420 }}>
              <p className="small muted">{t("w_create_login_lead")}</p>
              <TelegramSignIn lang={lang} next="/#create" />
              <p className="small muted" style={{ marginTop: 10 }}>
                {t("w_signin_hint")}
              </p>
            </div>
          </div>
        </main>
      </>
    );
  }

  const pending = groups.reduce((sum, group) => sum + (group.pending ?? 0), 0);
  const meetingLabels: MeetingLabels = {
    list: t("w_side_meetings"),
    count: (n: number) => tn(lang, "w_meetings_count", n),
    going: t("w_side_going", { n: "{n}", total: "{total}" }),
    awaiting: t("w_side_awaiting"),
  };

  return (
    <LandingShell
      // Вернулись с ошибкой кода группы — поле кода в сайдбаре, открываем его сразу.
      initialOpen={joinError !== null}
      labels={{ groups: t("w_my_groups"), open: t("w_sidebar_expand"), close: t("w_close") }}
      topbar={
        <Topbar lang={lang} panel={panel}>
          <GroupsButton label={t("w_my_groups")} count={pending} />
        </Topbar>
      }
      sidebar={
        <>
          <p className="eyebrow sidebar-eyebrow">{t("w_my_groups")}</p>
          {groups.length > 0 ? (
            <nav className="sidebar-nav" aria-label={t("w_my_groups")}>
              {groups.map((group) => (
                <div className="sidebar-item" key={group.chatId}>
                  <GroupLink group={group} pendingLabel={t("w_pending_label", { n: String(group.pending ?? 0) })} />
                  <GroupMeetings group={group} open={false} labels={meetingLabels} />
                </div>
              ))}
            </nav>
          ) : (
            <p className="small muted sidebar-empty">{t("w_no_groups")}</p>
          )}

          <a className="sidebar-link sidebar-create" href="#create" title={t("w_pp_create")}>
            <IconPlus size={18} />
            <span className="sidebar-label">{t("w_pp_create")}</span>
          </a>

          <form action={joinByCodeAction} className="sidebar-join" id="join">
            <label className="eyebrow" htmlFor="join-code">
              {t("w_join_code_title")}
            </label>
            {joinError && (
              <p className="small sidebar-join-error" role="alert">
                {t(joinError)}
              </p>
            )}
            <div className="sidebar-join-row">
              <input
                id="join-code"
                type="text"
                name="code"
                required
                maxLength={40}
                autoComplete="off"
                spellCheck={false}
                placeholder={t("w_join_code_ph")}
              />
              <button className="btn btn-sm" type="submit">
                {t("w_join_code_btn")}
              </button>
            </div>
          </form>

          <div className="sidebar-foot">
            <ProfilePanel {...panel} />
            <span className="small muted sidebar-me sidebar-label">{panel.user?.name ?? t("w_profile")}</span>
          </div>
        </>
      }
    >
      {/* Группы уже отсортированы по свежести — первая и есть последняя открытая. */}
      <OpenLastGroup slug={groups[0]?.slug ?? null} />
      <main className="wrap">{showcase}</main>
      <SiteFooter lang={lang} />
      <CreateGroupDialog
        action={createGroup}
        timezones={TIMEZONES}
        langs={Object.entries(LANG_NAMES)}
        defaultLang={lang}
        labels={{
          title: t("w_create"),
          name: t("w_group_title"),
          namePh: t("w_group_title_ph"),
          tz: t("w_tz"),
          lang: t("w_lang"),
          submit: t("w_create"),
          close: t("w_close"),
        }}
      />
    </LandingShell>
  );
}
