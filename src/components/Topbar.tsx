import Link from "next/link";

import { displayName } from "@/db/schema";
import * as repo from "@/db/repo";
import { translator } from "@/i18n";
import { currentUser } from "@/lib/auth";
import { ProfilePanel, type ProfileGroup, type ProfileUser } from "./ProfilePanel";

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

  let profile: ProfileUser | null = null;
  let groups: ProfileGroup[] = [];
  if (user) {
    const credentials = await repo.getCredentials(user.userId);
    profile = {
      name: displayName(user),
      telegram: !user.isWeb && user.username ? user.username : null,
      login: credentials?.login ?? null,
    };
    const chats = await repo.userChats(user.userId);
    groups = chats
      .filter((chat) => chat.slug)
      .map((chat) => ({ chatId: chat.chatId, slug: chat.slug!, title: chat.title }))
      .sort((a, b) => a.title.localeCompare(b.title, lang));
  }

  return (
    <header className="topbar">
      <ProfilePanel
        user={profile}
        groups={groups}
        labels={{
          profile: t("w_profile"),
          close: t("w_close"),
          myGroups: t("w_my_groups"),
          noGroups: t("w_no_groups"),
          leaveGroup: t("w_pp_leave_group", { title: "{title}" }),
          leaveConfirm: t("w_leave_confirm"),
          joinPh: t("w_pp_join_ph"),
          joinBtn: t("w_pp_join_btn"),
          createGroup: t("w_pp_create"),
          anon: t("w_profile_anon"),
          account: t("w_acct_title"),
          login: t("w_login_btn"),
          logout: t("w_logout"),
          loginLabel: t("w_pp_login_label", { login: "{login}" }),
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
