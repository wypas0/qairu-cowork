import { cookies } from "next/headers";
import Link from "next/link";

import { translator } from "@/i18n";
import { SIDEBAR_COOKIE } from "@/lib/cookies";
import { BrandMark, IconCalendarUser, IconClock, IconMeeting, IconPlus } from "./icons";
import { ProfilePanel, type ProfileGroup } from "./ProfilePanel";
import { profilePanelProps } from "./profilePanelProps";
import { SidebarToggle } from "./SidebarToggle";
import { HomeScreenPrompt } from "./TelegramHome";
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
                <NextMeeting group={group} label={t("w_side_next")} />
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
                <NextMeeting group={group} label={t("w_side_next")} />
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
        </div>
        {children}
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

/** Строка группы: знак, название, счётчик «ждёт тебя». В свёрнутой панели остаются знак и счётчик. */
function GroupLink({
  group,
  current = false,
  pendingLabel,
}: {
  group: ProfileGroup;
  current?: boolean;
  pendingLabel: string;
}) {
  return (
    <Link
      className={`sidebar-link sidebar-group${current ? " current" : ""}`}
      href={`/g/${group.slug}`}
      title={group.title}
    >
      <span className="sidebar-mark" aria-hidden="true">
        {group.title.trim()[0]?.toUpperCase() ?? "?"}
      </span>
      <span className="sidebar-title">{group.title}</span>
      {group.pending ? (
        <span className="count-badge" aria-label={pendingLabel}>
          {group.pending}
        </span>
      ) : null}
    </Link>
  );
}

/**
 * Ближайшая встреча группы прямо под её названием: когда и о чём.
 * Нажатие открывает эту встречу во вкладке «Встречи».
 */
function NextMeeting({ group, label }: { group: ProfileGroup; label: string }) {
  if (!group.next) return null;
  return (
    <Link
      className="sidebar-next"
      href={`/g/${group.slug}?at=meeting-${group.next.id}`}
      aria-label={`${label}: ${group.next.when}${group.next.about ? `, ${group.next.about}` : ""}`}
    >
      <span className="sidebar-next-when">
        <IconClock size={14} />
        {group.next.when}
      </span>
      {group.next.about && <span className="sidebar-next-about">{group.next.about}</span>}
    </Link>
  );
}
