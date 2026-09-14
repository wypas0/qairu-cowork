import Link from "next/link";

import { displayName } from "@/db/schema";
import * as repo from "@/db/repo";
import { translator } from "@/i18n";
import { currentUser } from "@/lib/auth";
import { ProfilePanel, type ProfileGroup, type ProfileMeeting } from "./ProfilePanel";

export async function Topbar({
  children,
  lang: langOverride,
}: {
  children?: React.ReactNode;
  lang?: string;
}) {
  const user = await currentUser();
  const lang = langOverride ?? user?.lang ?? "ru";
  const t = translator(lang);

  let groups: ProfileGroup[] = [];
  let meetings: ProfileMeeting[] = [];
  if (user) {
    const chats = await repo.userChats(user.userId);
    groups = chats
      .filter((chat) => chat.slug)
      .map((chat) => ({ chatId: chat.chatId, slug: chat.slug!, title: chat.title }));

    const rows = await repo.userMeetings(user.userId);
    meetings = rows
      .filter((row) => row.chat.slug)
      .map((row) => ({
        id: row.meeting.id,
        chatSlug: row.chat.slug!,
        chatTitle: row.chat.title,
        place: row.meeting.place,
        whenText: row.meeting.whenText,
        goal: row.meeting.goal,
      }));
  }

  return (
    <header className="topbar">
      <ProfilePanel
        userName={user ? displayName(user) : null}
        groups={groups}
        meetings={meetings}
        labels={{
          profile: t("w_profile"),
          close: t("w_close"),
          myGroups: t("w_my_groups"),
          noGroups: t("w_no_groups"),
          leave: t("w_leave"),
          leaveConfirm: t("w_leave_confirm"),
          meetings: t("w_meetings"),
          noMeetings: t("w_no_meetings"),
          joinOther: t("w_join_other"),
          joinOtherPh: t("w_join_other_ph"),
          joinOtherBtn: t("w_join_other_btn"),
          anon: t("w_profile_anon"),
          account: t("w_acct_title"),
          login: t("w_login_btn"),
          logout: t("w_logout"),
        }}
      />
      <Link className="brand" href="/">
        <span className="brand-mark" aria-hidden="true" />
        <span>
          Qairu<b>Cowork</b>
        </span>
      </Link>
      <span className="spacer" />
      {children}
      {!user && (
        <Link className="btn btn-sm" href="/login">
          {t("w_login_btn")}
        </Link>
      )}
    </header>
  );
}
