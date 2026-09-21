import Link from "next/link";

import { translator } from "@/i18n";
import { BrandMark, IconCalendarUser, IconMeeting, IconPlus } from "./icons";
import { ProfilePanel } from "./ProfilePanel";
import { profilePanelProps } from "./profilePanelProps";
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

  const groups = panel.groups.some((group) => group.slug === slug)
    ? panel.groups
    : [{ chatId: 0, slug, title }, ...panel.groups];

  const links = [
    { key: "group" as const, href: `/g/${slug}`, label: t("w_nav_group"), Icon: IconMeeting },
    { key: "me" as const, href: `/g/${slug}/me`, label: t("w_nav_me"), Icon: IconCalendarUser },
  ];

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link className="brand sidebar-brand" href="/">
          <BrandMark className="brand-mark" />
          <span>
            Qairu<b>Cowork</b>
          </span>
        </Link>

        {/* Все группы одним списком. Текущая не пропадает из него, а выделяется,
            и её разделы раскрыты прямо под ней — как рабочие пространства
            в Slack или Notion: сразу видно, где ты и куда можно перейти. */}
        <p className="eyebrow sidebar-eyebrow">{t("w_my_groups")}</p>
        <nav className="sidebar-nav" aria-label={t("w_my_groups")}>
          {groups.map((group) =>
            group.slug === slug ? (
              <div className="sidebar-current" key={group.chatId}>
                <Link className="sidebar-link sidebar-group current" href={`/g/${group.slug}`}>
                  <span className="sidebar-mark" aria-hidden="true">
                    {group.title.trim()[0]?.toUpperCase() ?? "?"}
                  </span>
                  <span className="sidebar-title">{group.title}</span>
                </Link>
                <div className="sidebar-sub">
                  {links.map((link) => (
                    <Link
                      key={link.key}
                      className={`sidebar-link${section === link.key ? " active" : ""}`}
                      href={link.href}
                      aria-current={section === link.key ? "page" : undefined}
                    >
                      <link.Icon size={18} />
                      {link.label}
                    </Link>
                  ))}
                </div>
              </div>
            ) : (
              <Link className="sidebar-link sidebar-group" key={group.chatId} href={`/g/${group.slug}`}>
                <span className="sidebar-mark" aria-hidden="true">
                  {group.title.trim()[0]?.toUpperCase() ?? "?"}
                </span>
                <span className="sidebar-title">{group.title}</span>
              </Link>
            ),
          )}
        </nav>

        <Link className="sidebar-link sidebar-create" href="/#create">
          <IconPlus size={18} />
          {t("w_pp_create")}
        </Link>

        <div className="sidebar-foot">
          <ProfilePanel {...panel} />
          <span className="small muted sidebar-me">{panel.user?.name ?? t("w_profile")}</span>
        </div>
      </aside>

      <div className="shell-main">
        <Topbar lang={lang} panel={panel} />
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
