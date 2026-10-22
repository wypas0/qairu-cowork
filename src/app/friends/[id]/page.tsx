import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { CopyButton } from "@/components/CopyButton";
import { FlashToast } from "@/components/FlashToast";
import { PersonAvatar } from "@/components/friends/PersonAvatar";
import { IconChevronLeft } from "@/components/icons";
import { Topbar } from "@/components/Topbar";
import { fmtInterval } from "@/core/intervals";
import { type DateStr, formatDM, utcToZonedWall, weekdayOf } from "@/core/timeutils";
import * as repo from "@/db/repo";
import { displayName } from "@/db/schema";
import { tn, translator, weekdayShort } from "@/i18n";
import { defaultTz } from "@/lib/config";
import * as friends from "@/lib/friends";
import { loginUrl, pageUser } from "@/lib/gate";
import { askToJoinAction, blockUserAction, inviteFriendsAction, removeFriendAction } from "../actions";
import { friendFlash } from "../flash";

export const dynamic = "force-dynamic";

/**
 * Карточка друга: его группы (видимые мне, без кодов), когда мы оба свободны,
 * позвать в свою группу, удалить или заблокировать. Не друг — «не найдено»:
 * по адресу нельзя узнать, есть ли такой человек.
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
  // Куда можно позвать: мои группы без него и без живого приглашения.
  const sharedIds = new Set(shared.map((group) => group.chatId));
  const invitable = [];
  for (const group of mine) {
    if (sharedIds.has(group.chatId)) continue;
    if ((await repo.invitedTo(group.chatId, now)).has(friend.userId)) continue;
    invitable.push(group);
  }
  const name = displayName(friend);
  const flash = friendFlash(t, query.fr);
  const dayLabel = (day: DateStr) => `${weekdayShort(lang, weekdayOf(day))} ${formatDM(day)}`;
  const freeText =
    free.status === "ok"
      ? [
          t("w_fr_free_copy_head", { name }),
          ...free.days.map((entry) => `${dayLabel(entry.day)}: ${entry.windows.map((window) => fmtInterval(window)).join(", ")}`),
        ].join("\n")
      : "";

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
        </header>
        <FlashToast message={flash.message} tone={flash.tone} params={["fr"]} />

        <div className="split">
          <div className="split-main split-stack">
            <section className="card">
              <h2>{t("w_fr_groups_of", { name })}</h2>
              {!groups.visible ? (
                <p className="small muted">{t("w_fr_groups_hidden", { name })}</p>
              ) : groups.groups.length === 0 ? (
                <p className="small muted">{t("w_fr_groups_none", { name })}</p>
              ) : (
                <ul className="fr-list">
                  {groups.groups.map((group) => (
                    <li className="fr-row" key={group.chatId}>
                      <span className="fr-who">
                        <b>{group.title}</b>
                        <span className="small muted">{tn(lang, "w_fr_members", group.members)}</span>
                      </span>
                      <div className="fr-actions">
                        {group.mine && group.slug ? (
                          <>
                            <span className="badge ok">{t("w_fr_you_there")}</span>
                            <Link className="btn btn-sm" href={`/g/${group.slug}`}>
                              {t("w_fr_open")}
                            </Link>
                          </>
                        ) : group.asked ? (
                          <span className="badge">{t("w_fr_asked")}</span>
                        ) : (
                          <form action={askToJoinAction}>
                            <input type="hidden" name="friend" value={friend.userId} />
                            <input type="hidden" name="chat" value={group.chatId} />
                            <input type="hidden" name="next" value={path} />
                            <button className="btn btn-sm" type="submit">
                              {t("w_fr_ask")}
                            </button>
                          </form>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card">
              <div className="card-head">
                <h2>{t("w_fr_free_title")}</h2>
                {freeText && <CopyButton value={freeText} label={t("w_fr_free_copy")} copiedLabel={t("w_copied")} small />}
              </div>
              <p className="small muted">{t("w_fr_free_lead")}</p>
              {free.status === "hidden" ? (
                <p className="small muted">{t("w_fr_free_hidden")}</p>
              ) : free.status === "missing" ? (
                <p className="small muted">{free.me ? t("w_fr_free_missing_me") : t("w_fr_free_missing", { name })}</p>
              ) : free.days.length === 0 ? (
                <div className="empty">
                  <h3>{t("w_fr_free_none")}</h3>
                </div>
              ) : (
                <ul className="windows fr-free">
                  {free.days.map((entry) => (
                    <li key={entry.day}>
                      <span className="fr-free-day">{dayLabel(entry.day)}</span>
                      <span className="when">{entry.windows.map((window) => fmtInterval(window)).join(", ")}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <div className="split-side split-stack">
            <section className="card">
              <h2>{t("w_fr_invite_title")}</h2>
              {invitable.length === 0 ? (
                <p className="small muted">{t("w_fr_invite_none", { name })}</p>
              ) : (
                <form action={inviteFriendsAction} className="fr-invite">
                  <input type="hidden" name="friend" value={friend.userId} />
                  <input type="hidden" name="next" value={path} />
                  <label htmlFor="fr-invite-chat">{t("w_fr_invite_pick")}</label>
                  <select id="fr-invite-chat" name="chat" required>
                    {invitable.map((group) => (
                      <option key={group.chatId} value={group.chatId}>
                        {group.title}
                      </option>
                    ))}
                  </select>
                  <button className="btn" type="submit">
                    {t("w_fr_invite_btn")}
                  </button>
                </form>
              )}
              {shared.length > 0 && (
                <>
                  <h3>{t("w_fr_shared_title")}</h3>
                  <ul className="fr-chips">
                    {shared.map((group) =>
                      group.slug ? (
                        <li key={group.chatId}>
                          <Link className="chip" href={`/g/${group.slug}`}>
                            {group.title}
                          </Link>
                        </li>
                      ) : null,
                    )}
                  </ul>
                </>
              )}
            </section>

            <section className="card">
              <h2>{t("w_fr_manage")}</h2>
              <div className="fr-danger">
                <form action={removeFriendAction}>
                  <input type="hidden" name="user_id" value={friend.userId} />
                  <ConfirmSubmit className="btn btn-sm btn-quiet" confirm={t("w_fr_remove_confirm", { name })}>
                    {t("w_fr_remove")}
                  </ConfirmSubmit>
                </form>
                <form action={blockUserAction}>
                  <input type="hidden" name="user_id" value={friend.userId} />
                  <ConfirmSubmit className="btn btn-sm btn-quiet btn-danger" confirm={t("w_fr_block_confirm", { name })}>
                    {t("w_fr_block")}
                  </ConfirmSubmit>
                </form>
              </div>
              <p className="small muted">{t("w_fr_block_hint")}</p>
            </section>
          </div>
        </div>
      </main>
    </>
  );
}
