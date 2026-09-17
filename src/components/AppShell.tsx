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

        <p className="eyebrow sidebar-eyebrow">{title}</p>
        <nav className="sidebar-nav">
          {links.map((link) => (
            <Link
              key={link.key}
              className={`sidebar-link${section === link.key ? " active" : ""}`}
              href={link.href}
            >
              <link.Icon size={18} />
              {link.label}
            </Link>
          ))}
        </nav>

        {panel.groups.length > 1 && (
          <>
            <p className="eyebrow sidebar-eyebrow">{t("w_my_groups")}</p>
            <nav className="sidebar-nav">
              {panel.groups
                .filter((group) => group.slug !== slug)
                .map((group) => (
                  <Link className="sidebar-link" key={group.chatId} href={`/g/${group.slug}`}>
                    <span className="sidebar-mark" aria-hidden="true">
                      {group.title.trim()[0]?.toUpperCase() ?? "?"}
                    </span>
                    <span className="sidebar-title">{group.title}</span>
                  </Link>
                ))}
            </nav>
          </>
        )}

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
