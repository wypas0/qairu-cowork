import { cookies } from "next/headers";

import { displayName } from "@/db/schema";
import * as repo from "@/db/repo";
import { translator } from "@/i18n";
import { currentUser } from "@/lib/auth";
import { hasBot } from "@/lib/config";
import { THEME_COOKIE, normalizeTheme } from "@/lib/theme";
import type { ProfileGroup, ProfilePanelProps, ProfileUser } from "./ProfilePanel";
import { RECENT_COOKIE, parseRecent } from "@/lib/cookies";
import { upcomingByChat } from "@/core/recurrence";
import { addDays, chatTz, formatDM, startsSoon, todayIn, utcToZonedWall, weekdayOf } from "@/core/timeutils";
import { fmtMinutes } from "@/core/intervals";
import { weekdayShort } from "@/i18n";

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
    groups = await userGroups(user.userId, lang);
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

/**
 * Группы человека в том порядке, в каком их удобно выбирать: сначала те, где
 * он был недавно (по куке последних групп), потом остальные по алфавиту.
 * У каждой — сколько там его ждёт.
 */
export async function userGroups(userId: number, lang: string): Promise<ProfileGroup[]> {
  const chats = await repo.userChats(userId);
  const pending = await repo.pendingCounts(userId);
  const recent = parseRecent((await cookies()).get(RECENT_COOKIE)?.value);
  const rank = (slug: string) => {
    const index = recent.indexOf(slug);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  const now = new Date();
  const tzById = new Map(chats.map((chat) => [chat.chatId, chatTz(chat)]));
  const tzOf = (chatId: number) => tzById.get(chatId) ?? chatTz(null);
  const upcoming = upcomingByChat(
    await repo.feedMeetings(
      chats.map((chat) => chat.chatId),
      now,
    ),
    tzOf,
    now,
  );
  const t = translator(lang);
  const answers = await repo.meetingResponsesForMany(
    [...upcoming.values()].flat().map(({ meeting }) => meeting.id),
  );

  return chats
    .filter((chat) => chat.slug)
    .map((chat) => {
      return {
        chatId: chat.chatId,
        slug: chat.slug!,
        title: chat.title,
        pending: pending.get(chat.chatId) ?? 0,
        meetings: (upcoming.get(chat.chatId) ?? []).map(({ meeting, start }) => {
          const invitees = repo.inviteeIds(meeting);
          const replies = answers.get(meeting.id) ?? [];
          const soon = startsSoon(start, now);
          return {
            id: meeting.id,
            when: nextWhen(start, tzOf(chat.chatId), now, lang, t),
            soon: soon ? t(soon.unit === "min" ? "w_in_minutes" : "w_in_hours", { n: soon.n }) : null,
            about: [meeting.goal, meeting.place]
              .map((part) => part.trim())
              .filter(Boolean)
              .join(" · "),
            going: invitees.filter((id) => replies.some((reply) => reply.userId === id && reply.answer === "yes"))
              .length,
            invited: invitees.length,
            awaiting: invitees.includes(userId) && !replies.some((reply) => reply.userId === userId),
          };
        }),
      };
    })
    .sort((a, b) => rank(a.slug) - rank(b.slug) || a.title.localeCompare(b.title, lang));
}

/** «Сегодня, 15:00», «Завтра, 15:00» или «Чт 24.09, 15:00» — в поясе группы. */
function nextWhen(
  start: Date,
  tz: string,
  now: Date,
  lang: string,
  t: ReturnType<typeof translator>,
): string {
  const { day, minutes } = utcToZonedWall(start, tz);
  const time = fmtMinutes(minutes);
  const today = todayIn(tz, now);
  if (day === today) return t("w_side_today", { time });
  if (day === addDays(today, 1)) return t("w_side_tomorrow", { time });
  return `${weekdayShort(lang, weekdayOf(day))} ${formatDM(day)}, ${time}`;
}
