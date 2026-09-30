import { cookies } from "next/headers";
import Link from "next/link";

import { tn, translator } from "@/i18n";
import { SIDEBAR_COOKIE } from "@/lib/cookies";
import { BrandMark, IconCalendarUser, IconMeeting, IconPlus } from "./icons";
import { ProfilePanel } from "./ProfilePanel";
import { profilePanelProps } from "./profilePanelProps";
import { GroupLink, GroupMeetings, type MeetingLabels } from "./SidebarGroups";
import { SidebarToggle } from "./SidebarToggle";
import { SiteFooter } from "./SiteFooter";
import { HomeScreenPrompt, WriteAccessPrompt } from "./TelegramHome";
import { Topbar } from "./Topbar";

/** Какой раздел группы открыт — подсвечивается и в сайдбаре, и в нижней панели. */
export type ShellSection = "group" | "me";

/**
 * Оболочка страниц группы.
 *
 * Навигации у продукта раньше не было вовсе: все группы и весь аккаунт жили в
 * выезжающей панели профиля, а переключиться между «расписанием группы» и
 * «моим расписанием» можно было одной кнопкой в шапке. Здесь на широком экране
 * появляется сайдбар со списком групп и разделами, а на телефоне — нижняя
 * панель с теми же двумя разделами: большой палец достаёт до неё, а до шапки нет.
 */
export async function AppShell({
  lang,
  slug,
  title,
  section,
  children,
}: {
  lang: string;
  slug: string;
  title: string;
  section: ShellSection;
  children: React.ReactNode;
}) {
  const t = translator(lang);
  const panel = await profilePanelProps(lang);
  const closed = (await cookies()).get(SIDEBAR_COOKIE)?.value === "closed";

  const groups = panel.groups.some((group) => group.slug === slug)
    ? panel.groups
    : [{ chatId: 0, slug, title }, ...panel.groups];

  const meetingLabels: MeetingLabels = {
    list: t("w_side_meetings"),
    count: (n: number) => tn(lang, "w_meetings_count", n),
    going: t("w_side_going", { n: "{n}", total: "{total}" }),
    awaiting: t("w_side_awaiting"),
  };

  const links = [
    { key: "group" as const, href: `/g/${slug}`, label: t("w_nav_group"), Icon: IconMeeting },
    { key: "me" as const, href: `/g/${slug}/me`, label: t("w_nav_me"), Icon: IconCalendarUser },
  ];

  return (
    <div className={`shell${closed ? " sidebar-closed" : ""}`}>
      <aside className="sidebar" id="sidebar">
        <div className="sidebar-top">
          <Link className="brand sidebar-brand" href="/">
            <BrandMark className="brand-mark" />
            <span className="sidebar-label">
              Qairu<b>Cowork</b>
            </span>
          </Link>
          <SidebarToggle
            initialClosed={closed}
            labels={{ collapse: t("w_sidebar_collapse"), expand: t("w_sidebar_expand") }}
          />
        </div>

        {/* Все группы одним списком. Текущая не пропадает из него, а выделяется,
            и её разделы раскрыты прямо под ней — как рабочие пространства
            в Slack или Notion: сразу видно, где ты и куда можно перейти. */}
        <p className="eyebrow sidebar-eyebrow">{t("w_my_groups")}</p>
        <nav className="sidebar-nav" aria-label={t("w_my_groups")}>
          {groups.map((group) =>
            group.slug === slug ? (
              <div className="sidebar-current" key={group.chatId}>
                <GroupLink group={group} current pendingLabel={t("w_pending_label", { n: String(group.pending ?? 0) })} />
                <GroupMeetings group={group} open labels={meetingLabels} />
                <div className="sidebar-sub">
                  {links.map((link) => (
                    <Link
                      key={link.key}
                      className={`sidebar-link${section === link.key ? " active" : ""}`}
                      href={link.href}
                      title={link.label}
                      aria-current={section === link.key ? "page" : undefined}
                    >
                      <link.Icon size={18} />
                      <span className="sidebar-label">{link.label}</span>
                    </Link>
                  ))}
                </div>
              </div>
            ) : (
              <div className="sidebar-item" key={group.chatId}>
                <GroupLink group={group} pendingLabel={t("w_pending_label", { n: String(group.pending ?? 0) })} />
                <GroupMeetings group={group} open={false} labels={meetingLabels} />
              </div>
            ),
          )}
        </nav>

        <Link className="sidebar-link sidebar-create" href="/#create" title={t("w_pp_create")}>
          <IconPlus size={18} />
          <span className="sidebar-label">{t("w_pp_create")}</span>
        </Link>

        <div className="sidebar-foot">
          <ProfilePanel {...panel} />
          <span className="small muted sidebar-me sidebar-label">{panel.user?.name ?? t("w_profile")}</span>
        </div>
      </aside>

      <div className="shell-main">
        <Topbar lang={lang} panel={panel} />
        <div className="wrap home-screen-wrap">
          <HomeScreenPrompt
            labels={{ text: t("w_home_screen"), add: t("w_home_screen_add"), later: t("w_home_screen_later") }}
          />
          <WriteAccessPrompt
            labels={{ text: t("w_write_access"), allow: t("w_write_access_allow"), later: t("w_home_screen_later") }}
          />
        </div>
        {children}
        <SiteFooter lang={lang} />
        <nav className="bottomnav" aria-label={title}>
          {links.map((link) => (
            <Link
              key={link.key}
              className={`bottomnav-link${section === link.key ? " active" : ""}`}
              href={link.href}
            >
              <link.Icon size={20} />
              <span>{link.label}</span>
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
