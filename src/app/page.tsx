import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";

import { CreateGroupDialog } from "@/components/CreateGroupDialog";
import { FriendsLink } from "@/components/friends/FriendsLink";
import { IconPlus } from "@/components/icons";
import { GroupsButton, LandingShell } from "@/components/LandingShell";
import { Bento } from "@/components/landing/Bento";
import { Faq } from "@/components/landing/Faq";
import { Hero } from "@/components/landing/Hero";
import { Manifest } from "@/components/landing/Manifest";
import { landingMetadata } from "@/components/landing/meta";
import { StartBlock } from "@/components/landing/StartBlock";
import { StoryScene } from "@/components/landing/StoryScene";
import { ProfilePanel } from "@/components/ProfilePanel";
import { GroupLink, GroupMeetings, type MeetingLabels } from "@/components/SidebarGroups";
import { SiteFooter } from "@/components/SiteFooter";
import { OpenLastGroup } from "@/components/TelegramHome";
import { profilePanelProps } from "@/components/profilePanelProps";
import { Topbar } from "@/components/Topbar";
import { formatDM, utcToZonedWall, chatTz } from "@/core/timeutils";
import * as repo from "@/db/repo";
import { LANG_NAMES, normalizeLang, tn, translator } from "@/i18n";
import { currentUser } from "@/lib/auth";
import { loginUrl, pageUser } from "@/lib/gate";
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

/** Заголовок, описание и og:locale — на языке посетителя, как и сама страница. */
export async function generateMetadata(): Promise<Metadata> {
  const user = await currentUser();
  const requestHeaders = await headers();
  return landingMetadata(user?.lang ?? normalizeLang((requestHeaders.get("accept-language") ?? "").split(",")[0]));
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
  // Для вошедшего под витриной — его неделя; гостю внизу — блок «Старт».
  const updatedAt = user ? (await repo.scheduleUpdatedAt([user.userId])).get(user.userId) : undefined;
  const joinError =
    query.join === "bad" ? "w_join_err_bad" : query.join === "notfound" ? "w_join_err_notfound" : null;

  // Витрина одна для всех: гость узнаёт о продукте, вошедший возвращается к
  // ней логотипом. Свои группы у вошедшего — в сайдбаре, а не на странице.
  const showcase = (
    <>
      {/* «Создать группу»: вошедшему — окно на этой же странице, гостю — сначала вход. */}
      <Hero lang={lang} signedIn={user !== null} createHref={user ? "#create" : loginUrl("/#create")} />

      {user && (
        <section className="card your-week" aria-labelledby="your-week-title">
          <div className="card-head">
            <h2 id="your-week-title">{t("w_week_you_title")}</h2>
            {groups[0] && (
              <Link className="btn btn-sm" href={`/g/${groups[0].slug}/me`}>
                {updatedAt ? t("w_week_you_update") : t("w_week_you_fill")}
              </Link>
            )}
          </div>
          <p className="small muted">
            {updatedAt
              ? t("w_week_you_schedule", { date: formatDM(utcToZonedWall(updatedAt, chatTz(null)).day) })
              : t("w_week_you_schedule_empty")}
          </p>
          {groups.length === 0 ? (
            <p className="small">{t("w_week_you_no_groups")}</p>
          ) : (
            <ul className="your-week-list">
              {groups.map((group) => {
                const meetings = group.meetings ?? [];
                const awaiting = meetings.filter((meeting) => meeting.awaiting).length;
                return (
                  <li key={group.chatId}>
                    <Link href={`/g/${group.slug}`} className="your-week-row">
                      <b>{group.title}</b>
                      <span className="small muted">
                        {meetings.length > 0
                          ? `${tn(lang, "w_meetings_count", meetings.length)} · ${meetings[0].when}`
                          : t("w_week_you_no_meetings")}
                      </span>
                      {awaiting > 0 && <span className="badge">{t("w_week_you_awaiting", { n: awaiting })}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {/* Как складывается неделя — сцена прокрутки вместо трёх карточек шагов. */}
      <StoryScene lang={lang} />

      <Manifest lines={t("w_manifest").split("|")} />

      <Bento lang={lang} />

      <Faq lang={lang} />
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

          <StartBlock lang={lang} joinError={joinError} />
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
                  <GroupMeetings meetings={group.meetings} open={false} labels={meetingLabels} />
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
          <FriendsLink
            label={t("w_fr_title")}
            count={panel.friendsBadge ?? 0}
            countLabel={t("w_fr_waiting_label", { n: String(panel.friendsBadge ?? 0) })}
          />
          <GroupMeetings meetings={panel.friendMeetings} open={false} labels={meetingLabels} />

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
