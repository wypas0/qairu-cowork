import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { CopyButton } from "@/components/CopyButton";
import { FlashToast } from "@/components/FlashToast";
import { type PlanDayView, PairPlanner } from "@/components/friends/PairPlanner";
import { PersonAvatar } from "@/components/friends/PersonAvatar";
import { HowToHint } from "@/components/HowToHint";
import { IconChevronLeft, IconChevronRight, IconMore, IconUserPlus } from "@/components/icons";
import { MeetingCard } from "@/components/MeetingCard";
import { Menu } from "@/components/Menu";
import { ScrollToAnchor } from "@/components/ScrollToAnchor";
import { Topbar } from "@/components/Topbar";
import { type Interval, fmtInterval } from "@/core/intervals";
import { planDays } from "@/core/pairPlan";
import { occurrencesBetween } from "@/core/recurrence";
import { type DateStr, addDays, formatDM, todayIn, utcToZonedWall, weekdayOf, zonedWallToUtc } from "@/core/timeutils";
import * as repo from "@/db/repo";
import { displayName } from "@/db/schema";
import { tn, translator, weekdayShort } from "@/i18n";
import { defaultTz } from "@/lib/config";
import * as friends from "@/lib/friends";
import { loginUrl, pageUser } from "@/lib/gate";
import { meetingDurationMin } from "@/lib/group";
import {
  askToJoinAction,
  blockUserAction,
  createPairMeetingAction,
  inviteFriendsAction,
  removeFriendAction,
} from "../actions";
import { friendFlash } from "../flash";

export const dynamic = "force-dynamic";

/**
 * Карточка друга. В шапке — «Позвать в группу» (сразу список групп) и «⋯»
 * (удалить, заблокировать). Главное ниже — встречи вдвоём: ваши ближайшие
 * (ответить, отменить) и «Встреча с …» — выбор времени по общим окнам,
 * приглашение уходит другу в Telegram карточкой с кнопками, как у встреч
 * группы. Сбоку — группы: общие и те, куда можно попроситься. Не друг —
 * «не найдено»: по адресу нельзя узнать, есть ли такой человек.
 */
export default async function FriendPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  if (!/^\d{1,16}$/.test(id)) notFound();
  const path = `/friends/${id}`;
  const user = await pageUser(path);
  if (!user) redirect(loginUrl(path));
  const me = user;
  const friend = await repo.getUser(Number(id));
  const rel = friend ? await friends.relationOf(me.userId, friend.userId) : null;
  if (!friend || !rel?.friends) notFound();

  const lang = me.lang;
  const t = translator(lang);
  const tz = defaultTz();
  const now = new Date();
  const today = todayIn(tz, now);

  const [groups, free, shared, mine, avatar, list, together] = await Promise.all([
    friends.friendGroups(me, friend, rel),
    friends.freeTogether(me, friend, now, rel),
    repo.sharedGroups(me.userId, friend.userId),
    repo.groupsOfUser(me.userId),
    repo.avatarVersion(friend.userId),
    repo.friendsOf(me.userId),
    repo.pairMeetingsBetween(me.userId, friend.userId, now, today),
  ]);
  const answers = await repo.meetingResponsesForMany([...together.upcoming, ...together.past].map((meeting) => meeting.id));
  const since = list.find((entry) => entry.user.userId === friend.userId)?.since;
  // Куда можно позвать: мои группы без него; с живым приглашением — отдельно.
  const sharedIds = new Set(shared.map((group) => group.chatId));
  const invitable: typeof mine = [];
  const pending: typeof mine = [];
  for (const group of mine) {
    if (sharedIds.has(group.chatId)) continue;
    if ((await repo.invitedTo(group.chatId, now)).has(friend.userId)) pending.push(group);
    else invitable.push(group);
  }
  const others = groups.groups.filter((group) => !group.mine);
  const name = displayName(friend);
  const names = new Map([
    [me.userId, displayName(me)],
    [friend.userId, name],
  ]);
  const flash = friendFlash(t, query.fr);
  const dayLabel = (day: DateStr) => `${weekdayShort(lang, weekdayOf(day))} ${formatDM(day)}`;

  // План встречи: две недели по дням — общие окна (или «неизвестно») и уже
  // назначенные встречи с ним, у серии — каждый повтор.
  const planStart = zonedWallToUtc(today, 0, tz);
  const planEnd = zonedWallToUtc(addDays(today, 14), 0, tz);
  const booked = new Map<DateStr, Interval[]>();
  for (const meeting of together.upcoming) {
    if (!meeting.whenStart) continue;
    const length = meetingDurationMin(meeting, tz);
    for (const start of occurrencesBetween(meeting.whenStart, meeting.repeatUntil, tz, planStart, planEnd)) {
      const { day, minutes } = utcToZonedWall(start, tz);
      booked.set(day, [...(booked.get(day) ?? []), [minutes, Math.min(minutes + length, 24 * 60)]]);
    }
  }
  const freeDays = new Map(free.status === "ok" ? free.days.map((entry) => [entry.day, entry.windows]) : []);
  const planView: PlanDayView[] = planDays(today).map((day) => ({
    day,
    label: dayLabel(day),
    windows: free.status === "ok" ? [...(freeDays.get(day) ?? [])] : null,
    meetings: booked.get(day) ?? [],
  }));
  const freeNote =
    free.status === "hidden"
      ? t("w_fr_free_hidden")
      : free.status === "missing"
        ? free.me
          ? t("w_fr_free_missing_me")
          : t("w_fr_free_missing", { name })
        : null;
  const freeText = [
    t("w_fr_free_copy_head", { name }),
    ...(free.status === "ok" ? free.days : [])
      .filter((entry) => entry.windows.length > 0)
      .map((entry) => `${dayLabel(entry.day)}: ${entry.windows.map((window) => fmtInterval(window)).join(", ")}`),
  ].join("\n");
  const anyFree = free.status === "ok" && free.days.some((entry) => entry.windows.length > 0);

  return (
    <>
      <ScrollToAnchor id={typeof query.at === "string" ? query.at : null} />
      <Topbar lang={lang} />
      <main className="wrap fr-page">
        <Link className="btn btn-sm btn-quiet fr-back" href="/friends">
          <IconChevronLeft size={16} /> {t("w_fr_title")}
        </Link>
        <header className="page-head fr-head">
          <div className="fr-head-who">
            <PersonAvatar user={friend} version={avatar} size={64} />
            <div>
              <p className="eyebrow">{t("w_fr_eyebrow_friend")}</p>
              <h1>{name}</h1>
              <p className="small muted fr-head-meta">
                {friend.username && (
                  <a href={`https://t.me/${friend.username}`} target="_blank" rel="noopener noreferrer">
                    @{friend.username}
                  </a>
                )}
                {friend.username && since && " · "}
                {since && t("w_fr_since", { date: formatDM(utcToZonedWall(since, tz).day) })}
              </p>
            </div>
          </div>
          <div className="fr-head-actions">
            {/* Главное действие страницы — встреча ниже, поэтому здесь кнопка вторичная. */}
            {invitable.length + pending.length > 0 ? (
              <Menu
                label={t("w_fr_invite_menu")}
                text={t("w_fr_invite_menu")}
                icon={<IconUserPlus size={16} />}
                className="btn btn-sm"
              >
                <p className="menu-title small muted">{t("w_fr_invite_pick")}</p>
                {invitable.map((group) => (
                  <form action={inviteFriendsAction} key={group.chatId}>
                    <input type="hidden" name="chat" value={group.chatId} />
                    <input type="hidden" name="friend" value={friend.userId} />
                    <input type="hidden" name="next" value={path} />
                    <button type="submit" className="menu-item">
                      {group.title}
                    </button>
                  </form>
                ))}
                {pending.map((group) => (
                  <button type="button" className="menu-item" disabled key={group.chatId}>
                    {group.title}
                    <span className="small muted">{t("w_fr_invited")}</span>
                  </button>
                ))}
              </Menu>
            ) : (
              <span className="small muted fr-head-note">{t("w_fr_invite_all", { name })}</span>
            )}
            <Menu label={t("w_fr_menu_more")} icon={<IconMore size={18} />} className="icon-btn">
              <form action={removeFriendAction}>
                <input type="hidden" name="user_id" value={friend.userId} />
                <ConfirmSubmit className="menu-item" confirm={t("w_fr_remove_confirm", { name })}>
                  {t("w_fr_remove")}
                </ConfirmSubmit>
              </form>
              <form action={blockUserAction}>
                <input type="hidden" name="user_id" value={friend.userId} />
                <ConfirmSubmit className="menu-item menu-danger" confirm={t("w_fr_block_confirm", { name })}>
                  {t("w_fr_block")}
                </ConfirmSubmit>
              </form>
              <p className="menu-note small muted">{t("w_fr_block_hint")}</p>
            </Menu>
          </div>
        </header>
        <FlashToast message={flash.message} tone={flash.tone} params={["fr"]} />
        <HowToHint id="friend" lang={lang} />

        <div className="split">
          <div className="split-main split-stack">
            {(together.upcoming.length > 0 || together.past.length > 0) && (
              <section className="card" id="meetings">
                <h2>{t("w_pair_meetings")}</h2>
                {together.upcoming.map((meeting) => (
                  <MeetingCard
                    key={meeting.id}
                    target={{ friendId: friend.userId }}
                    lang={lang}
                    tz={tz}
                    meeting={meeting}
                    answers={answers.get(meeting.id) ?? []}
                    names={names}
                    invitees={repo.inviteeIds(meeting)}
                    viewerId={me.userId}
                    canManage={meeting.initiatorId === me.userId}
                  />
                ))}
                {together.past.length > 0 && (
                  <details className="past-meetings">
                    <summary className="small muted">{t("w_past_meetings", { n: together.past.length })}</summary>
                    {together.past.map((meeting) => (
                      <MeetingCard
                        key={meeting.id}
                        target={{ friendId: friend.userId }}
                        lang={lang}
                        tz={tz}
                        meeting={meeting}
                        answers={answers.get(meeting.id) ?? []}
                        names={names}
                        invitees={repo.inviteeIds(meeting)}
                        viewerId={me.userId}
                        canManage={false}
                        past
                      />
                    ))}
                  </details>
                )}
              </section>
            )}

            <section className="card fr-free-card" id="plan">
              <h2>{t("w_pair_title")}</h2>
              <p className="small muted">{freeNote ?? t("w_pair_lead")}</p>
              <PairPlanner
                days={planView}
                today={today}
                todayFrom={utcToZonedWall(now, tz).minutes}
                action={createPairMeetingAction.bind(null, friend.userId)}
                extra={
                  anyFree ? (
                    <CopyButton value={freeText} label={t("w_fr_free_copy")} copiedLabel={t("w_copied")} small />
                  ) : null
                }
                labels={{
                  duration: t("w_duration"),
                  week: t("w_pair_week"),
                  suggest: t("w_pair_suggest"),
                  day: t("w_pair_day"),
                  start: t("w_pair_start"),
                  choose: t("w_pair_choose"),
                  dayNone: t("w_fr_free_day_none"),
                  dayShort: t("w_pair_day_short"),
                  anyTime: t("w_pair_any_time"),
                  goal: t("w_goal"),
                  goalPh: t("w_goal_ph"),
                  place: t("w_place"),
                  placePh: t("w_place_ph"),
                  repeat: t("w_repeat"),
                  repeatUntil: t("w_repeat_until"),
                  submit: t("w_pair_submit"),
                  durationTemplate: t("w_duration_hm", { h: "{h}", m: "{m}" }),
                  hoursOnlyTemplate: t("w_duration_h", { h: "{h}" }),
                  minutesTemplate: t("w_duration_m", { m: "{m}" }),
                }}
              />
            </section>
          </div>

          <section className="card split-side">
            <h2>{t("w_fr_groups_of", { name })}</h2>
            {shared.length > 0 && (
              <>
                <h3 className="fr-sub">{t("w_fr_groups_shared")}</h3>
                <ul className="fr-list">
                  {shared.map((group) =>
                    group.slug ? (
                      <li key={group.chatId}>
                        <Link className="fr-row fr-link" href={`/g/${group.slug}`}>
                          <span className="fr-who">
                            <b>{group.title}</b>
                          </span>
                          <IconChevronRight className="muted" />
                        </Link>
                      </li>
                    ) : null,
                  )}
                </ul>
              </>
            )}
            {!groups.visible ? (
              <p className="small muted fr-sub-note">{t("w_fr_groups_hidden", { name })}</p>
            ) : others.length > 0 ? (
              <>
                <h3 className="fr-sub">{t("w_fr_groups_other")}</h3>
                <ul className="fr-list">
                  {others.map((group) => (
                    <li className="fr-row" key={group.chatId}>
                      <span className="fr-who">
                        <b>{group.title}</b>
                        <span className="small muted">
                          {tn(lang, "w_fr_members", group.members)}
                          {group.invited && ` · ${t("w_fr_invited_you")}`}
                        </span>
                      </span>
                      <div className="fr-actions">
                        {group.invited ? (
                          <Link className="btn btn-sm btn-primary" href="/friends?tab=requests">
                            {t("w_fr_answer_invite")}
                          </Link>
                        ) : group.asked ? (
                          <span className="badge">{t("w_fr_asked")}</span>
                        ) : (
                          <form action={askToJoinAction}>
                            <input type="hidden" name="friend" value={friend.userId} />
                            <input type="hidden" name="chat" value={group.chatId} />
                            <input type="hidden" name="next" value={path} />
                            <button className="btn btn-sm btn-quiet" type="submit">
                              {t("w_fr_ask")}
                            </button>
                          </form>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            ) : shared.length === 0 ? (
              <p className="small muted fr-sub-note">{t("w_fr_groups_none")}</p>
            ) : null}
          </section>
        </div>
      </main>
    </>
  );
}
