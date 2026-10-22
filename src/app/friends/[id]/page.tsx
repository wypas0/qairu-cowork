import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { CopyButton } from "@/components/CopyButton";
import { FlashToast } from "@/components/FlashToast";
import { PersonAvatar } from "@/components/friends/PersonAvatar";
import { ShareButton } from "@/components/friends/ShareButton";
import { IconChevronLeft, IconChevronRight, IconMore, IconSend, IconUserPlus } from "@/components/icons";
import { Menu } from "@/components/Menu";
import { Topbar } from "@/components/Topbar";
import { fmtInterval } from "@/core/intervals";
import { type DateStr, formatDM, utcToZonedWall, weekdayOf } from "@/core/timeutils";
import * as repo from "@/db/repo";
import { displayName } from "@/db/schema";
import { tn, translator, weekdayShort } from "@/i18n";
import { defaultTz } from "@/lib/config";
import * as friends from "@/lib/friends";
import { loginUrl, pageUser } from "@/lib/gate";
import { baseUrl } from "@/lib/url";
import { askToJoinAction, blockUserAction, inviteFriendsAction, removeFriendAction } from "../actions";
import { friendFlash } from "../flash";

export const dynamic = "force-dynamic";

const SPAN = friends.TOGETHER.dayEnd - friends.TOGETHER.dayStart;
/** Где на полоске дня стоит время: доля от 8:00 до 22:00. */
const at = (minutes: number) => `${((minutes - friends.TOGETHER.dayStart) / SPAN) * 100}%`;
/** Подписи шкалы над полосками. */
const TICKS = [8, 12, 16, 20, 22];

/**
 * Карточка друга. В шапке — главные действия: «Позвать в группу» (сразу
 * список групп) и «⋯» (удалить, заблокировать). Ниже — группы: общие (строка
 * ведёт в группу) и те, куда можно попроситься; рядом — когда вы оба
 * свободны, полосками дня. Не друг — «не найдено»: по адресу нельзя узнать,
 * есть ли такой человек.
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

  const [groups, free, shared, mine, avatar, list] = await Promise.all([
    friends.friendGroups(me, friend, rel),
    friends.freeTogether(me, friend, now, rel),
    repo.sharedGroups(me.userId, friend.userId),
    repo.groupsOfUser(me.userId),
    repo.avatarVersion(friend.userId),
    repo.friendsOf(me.userId),
  ]);
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
  const flash = friendFlash(t, query.fr);
  const dayLabel = (day: DateStr) => `${weekdayShort(lang, weekdayOf(day))} ${formatDM(day)}`;
  const freeDays = free.status === "ok" ? free.days : [];
  const freeText = [
    t("w_fr_free_copy_head", { name }),
    ...freeDays
      .filter((entry) => entry.windows.length > 0)
      .map((entry) => `${dayLabel(entry.day)}: ${entry.windows.map((window) => fmtInterval(window)).join(", ")}`),
  ].join("\n");
  const anyFree = freeDays.some((entry) => entry.windows.length > 0);

  return (
    <>
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
            {invitable.length + pending.length > 0 ? (
              <Menu
                label={t("w_fr_invite_menu")}
                text={t("w_fr_invite_menu")}
                icon={<IconUserPlus size={16} />}
                className="btn btn-sm btn-primary"
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

        <div className="split">
          <section className="card split-main">
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

          <section className="card split-side fr-free-card">
            <h2>{t("w_fr_free_title")}</h2>
            <p className="small muted">{t("w_fr_free_lead")}</p>
            {free.status === "hidden" ? (
              <p className="small muted">{t("w_fr_free_hidden")}</p>
            ) : free.status === "missing" ? (
              <p className="small muted">{free.me ? t("w_fr_free_missing_me") : t("w_fr_free_missing", { name })}</p>
            ) : (
              <>
                <div className="fr-axis" aria-hidden="true">
                  {TICKS.map((hour) => (
                    <span key={hour} style={{ left: at(hour * 60) }}>
                      {hour}
                    </span>
                  ))}
                </div>
                <ul className="fr-days">
                  {free.days.map((entry) => (
                    <li key={entry.day}>
                      <span className="fr-day">{dayLabel(entry.day)}</span>
                      {/* Полоска дня 8–22: закрашено время, когда свободны оба. Числа — рядом. */}
                      <span className="fr-strip" aria-hidden="true">
                        {entry.windows.map(([start, end]) => (
                          <i key={start} style={{ left: at(start), width: `${((end - start) / SPAN) * 100}%` }} />
                        ))}
                      </span>
                      <span className={entry.windows.length ? "fr-day-times" : "fr-day-times muted"}>
                        {entry.windows.length
                          ? entry.windows.map((window) => fmtInterval(window)).join(", ")
                          : t("w_fr_free_day_none")}
                      </span>
                    </li>
                  ))}
                </ul>
                {anyFree ? (
                  <div className="fr-free-actions">
                    <ShareButton
                      via="telegram"
                      url={`${await baseUrl()}/friends/${me.userId}`}
                      text={freeText}
                      label={t("w_fr_free_tg")}
                      copied={t("w_copied")}
                      className="btn btn-sm"
                    >
                      <IconSend size={16} />
                    </ShareButton>
                    <CopyButton value={freeText} label={t("w_fr_free_copy")} copiedLabel={t("w_copied")} small />
                  </div>
                ) : (
                  <p className="small muted">{t("w_fr_free_none")}</p>
                )}
              </>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
