import { cookies } from "next/headers";

import { displayName } from "@/db/schema";
import * as repo from "@/db/repo";
import { translator } from "@/i18n";
import { currentUser } from "@/lib/auth";
import { hasBot } from "@/lib/config";
import { THEME_COOKIE, normalizeTheme } from "@/lib/theme";
import type { ProfileGroup, ProfilePanelProps, ProfileUser } from "./ProfilePanel";

/**
 * Данные для панели профиля. Панель открывается и из шапки на телефоне, и из
 * сайдбара на широком экране, поэтому сбор данных живёт отдельно от них обеих.
 */
export async function profilePanelProps(langOverride?: string): Promise<ProfilePanelProps> {
  const user = await currentUser();
  const lang = langOverride ?? user?.lang ?? "ru";
  const t = translator(lang);

  let profile: ProfileUser | null = null;
  let groups: ProfileGroup[] = [];
  if (user) {
    const credentials = await repo.getCredentials(user.userId);
    const avatar = await repo.avatarVersion(user.userId);
    profile = {
      name: displayName(user),
      realName: user.realName,
      telegram: !user.isWeb && user.username ? user.username : null,
      telegramLinked: !user.isWeb,
      login: credentials?.login ?? null,
      avatarUrl: avatar ? `/api/avatar/${user.userId}?v=${avatar}` : null,
    };
    const chats = await repo.userChats(user.userId);
    groups = chats
      .filter((chat) => chat.slug)
      .map((chat) => ({ chatId: chat.chatId, slug: chat.slug!, title: chat.title }))
      .sort((a, b) => a.title.localeCompare(b.title, lang));
  }

  const theme = normalizeTheme((await cookies()).get(THEME_COOKIE)?.value);

  return {
    user: profile,
    groups,
    theme,
    botEnabled: hasBot(),
    labels: {
    profile: t("w_profile"),
    close: t("w_close"),
    back: t("w_pp_back"),
    myGroups: t("w_my_groups"),
    noGroups: t("w_no_groups"),
    leaveGroup: t("w_pp_leave_group", { title: "{title}" }),
    leaveConfirm: t("w_leave_confirm"),
    joinPh: t("w_pp_join_ph"),
    joinBtn: t("w_pp_join_btn"),
    createGroup: t("w_pp_create"),
    anon: t("w_profile_anon"),
    login: t("w_login_btn"),
    loginLabel: t("w_pp_login_label", { login: "{login}" }),
    account: t("w_pp_account"),
    openAccount: t("w_pp_open_account"),
    photo: t("w_pp_photo"),
    changePhoto: t("w_pp_change_photo"),
    removePhoto: t("w_pp_remove_photo"),
    photoError: t("w_pp_photo_error"),
    photoTooLarge: t("w_pp_photo_too_large"),
    credentials: t("w_acct_title"),
    credentialsSet: t("w_pp_login_label", { login: "{login}" }),
    credentialsUnset: t("w_pp_credentials_unset"),
    logout: t("w_pp_logout"),
    realName: t("w_pp_name"),
    realNamePh: t("w_pp_name_ph"),
    realNameHint: t("w_pp_name_hint"),
    realNameSave: t("w_save"),
    realNameSaved: t("w_pp_name_saved"),
    realNameCleared: t("w_pp_name_cleared"),
    connectTelegram: t("w_pp_tg_connect"),
    connectTelegramHint: t("w_pp_tg_connect_hint"),
    telegramConnected: t("w_pp_tg_connected", { username: "{username}" }),
    telegramConnectedNoUsername: t("w_pp_tg_connected_plain"),
    theme: t("w_pp_theme"),
    themeSystem: t("w_pp_theme_system"),
    themeLight: t("w_pp_theme_light"),
    themeDark: t("w_pp_theme_dark"),
    },
  };
}
