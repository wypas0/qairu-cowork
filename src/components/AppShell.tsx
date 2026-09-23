import { cookies } from "next/headers";
import Link from "next/link";

import { tn, translator } from "@/i18n";
import { SIDEBAR_COOKIE } from "@/lib/cookies";
import { BrandMark, IconCalendarUser, IconChevronRight, IconClock, IconMeeting, IconPlus } from "./icons";
import { type GroupNextMeeting, ProfilePanel, type ProfileGroup } from "./ProfilePanel";
import { profilePanelProps } from "./profilePanelProps";
import { SidebarToggle } from "./SidebarToggle";
import { SiteFooter } from "./SiteFooter";
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

type MeetingLabels = {
  list: string;
  /** «3 встречи» — число в правильной форме. */
  count: (n: number) => string;
  /** «{n}/{total} идут» — литеральные {n} и {total}. */
  going: string;
  awaiting: string;
};

/**
 * Все предстоящие встречи группы под её названием, по времени: когда, о чём,
 * сколько идут и ждёт ли встреча твоего ответа. Нажатие открывает встречу во
 * вкладке «Встречи».
 *
 * Список текущей группы раскрыт, у остальных свёрнут в строку «3 встречи ·
 * Завтра, 16:00» — как рабочие пространства в Slack: при пяти группах со
 * встречами сайдбар иначе превращается в ленту.
 */
function GroupMeetings({
  group,
  open,
  labels,
}: {
  group: ProfileGroup;
  open: boolean;
  labels: MeetingLabels;
}) {
  const meetings = group.meetings ?? [];
  if (meetings.length === 0) return null;
  const awaiting = meetings.some((meeting) => meeting.awaiting);
  return (
    <details className="sidebar-fold" open={open}>
      <summary className="sidebar-fold-head">
        <IconChevronRight size={14} className="sidebar-fold-icon" />
        <span className="sidebar-fold-text">
          {labels.count(meetings.length)}
          <span className="sidebar-fold-when"> · {meetings[0].when}</span>
        </span>
        {awaiting && <span className="sidebar-dot" title={labels.awaiting} aria-label={labels.awaiting} />}
      </summary>
      <ul className="sidebar-meetings" aria-label={labels.list}>
        {meetings.map((meeting) => (
          <li key={meeting.id}>
            <Link
              className="sidebar-next"
              href={`/g/${group.slug}?at=meeting-${meeting.id}`}
              aria-label={[
                meeting.when,
                meeting.soon,
                meeting.about,
                meeting.invited > 0 ? goingText(meeting, labels) : null,
                meeting.awaiting ? labels.awaiting : null,
              ]
                .filter(Boolean)
                .join(", ")}
            >
              <span className="sidebar-next-when">
                {/* Ждёт твоего ответа — точка на месте значка часов, строка не растёт. */}
                {meeting.awaiting ? (
                  <span className="sidebar-dot-slot" aria-hidden="true">
                    <span className="sidebar-dot" />
                  </span>
                ) : (
                  <IconClock size={14} />
                )}
                {meeting.when}
                {meeting.soon && <span className="sidebar-soon">{meeting.soon}</span>}
              </span>
              {meeting.about && <span className="sidebar-next-about">{meeting.about}</span>}
              {meeting.invited > 0 && <span className="sidebar-next-going">{goingText(meeting, labels)}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}

function goingText(meeting: GroupNextMeeting, labels: MeetingLabels): string {
  return labels.going.replace("{n}", String(meeting.going)).replace("{total}", String(meeting.invited));
}
