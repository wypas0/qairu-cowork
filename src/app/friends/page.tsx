import Link from "next/link";
import { redirect } from "next/navigation";

import { miniAppFriendLink } from "@/bot/site";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { CopyButton } from "@/components/CopyButton";
import { FlashToast } from "@/components/FlashToast";
import { PersonAvatar } from "@/components/friends/PersonAvatar";
import { IconChevronRight } from "@/components/icons";
import { PageTabs } from "@/components/PageTabs";
import { QrCode } from "@/components/QrCode";
import { Topbar } from "@/components/Topbar";
import { formatDM, utcToZonedWall } from "@/core/timeutils";
import * as repo from "@/db/repo";
import { displayName, type User } from "@/db/schema";
import { tn, translator } from "@/i18n";
import { defaultTz, hasBot } from "@/lib/config";
import * as friends from "@/lib/friends";
import { loginUrl, pageUser } from "@/lib/gate";
import { baseUrl } from "@/lib/url";
import {
  answerInviteAction,
  answerRequestAction,
  cancelRequestAction,
  requestFriendAction,
  rotateFriendCodeAction,
  saveFriendSettingsAction,
  unblockUserAction,
} from "./actions";
import { friendFlash } from "./flash";

export const dynamic = "force-dynamic";

const TABS = ["friends", "requests", "add", "privacy"] as const;

/** Имя и ник одной строкой под именем: «@asel_n». */
function nick(user: User): string | null {
  return user.username ? `@${user.username}` : null;
}

/**
 * «Друзья»: список, заявки и приглашения, поиск по нику и личная ссылка,
 * приватность. Всё решает lib/friends; страница только показывает.
 */
export default async function FriendsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const user = await pageUser("/friends");
  if (!user) redirect(loginUrl("/friends"));
  const me = user;
  const lang = me.lang;
  const t = translator(lang);
  const now = new Date();
  const tz = defaultTz();

  const [list, incoming, outgoing, invites, asks, code, myGroups, blocked] = await Promise.all([
    repo.friendsOf(me.userId),
    repo.incomingRequests(me.userId),
    repo.outgoingRequests(me.userId),
    repo.incomingInvites(me.userId, "invite", now),
    repo.incomingInvites(me.userId, "ask", now),
    friends.friendCodeOf(me),
    repo.groupsOfUser(me.userId),
    repo.blockedUsersBy(me.userId),
  ]);
  const q = typeof query.q === "string" ? query.q.slice(0, 64) : "";
  const search = q.trim() ? await friends.searchByUsername(me, q) : null;

  const people = [
    ...list.map((entry) => entry.user),
    ...incoming.map((entry) => entry.from),
    ...outgoing.map((entry) => entry.to),
    ...invites.map((entry) => entry.from),
    ...asks.map((entry) => entry.from),
    ...blocked,
    ...(search?.code === "found" ? [search.user] : []),
  ];
  const [avatars, shared] = await Promise.all([
    repo.avatarVersions([...new Set(people.map((person) => person.userId))]),
    repo.sharedGroupCounts(
      me.userId,
      list.map((entry) => entry.user.userId),
    ),
  ]);
  const avatar = (person: User, size?: number) => (
    <PersonAvatar user={person} version={avatars.get(person.userId)} size={size} />
  );

  const base = await baseUrl();
  const linkUrl = `${base}/f/${code}`;
  const telegramLink = hasBot() ? await miniAppFriendLink(code).catch(() => null) : null;

  const waiting = incoming.length + invites.length + asks.length;
  const requested = typeof query.tab === "string" ? query.tab : "";
  const initial = (TABS as readonly string[]).includes(requested) ? requested : waiting > 0 ? "requests" : "friends";
  const flash = friendFlash(t, query.fr);
  const since = (at: Date) => formatDM(utcToZonedWall(at, tz).day);

  /** Человек в строке списка: фото, имя, ник и пояснение. */
  const who = (person: User, extra?: React.ReactNode) => (
    <span className="fr-who">
      <b>{displayName(person)}</b>
      <span className="small muted">
        {[nick(person), extra].filter(Boolean).map((part, index) => (
          <span key={index}>
            {index > 0 && " · "}
            {part}
          </span>
        ))}
      </span>
    </span>
  );

  const friendsPanel = (
    <section className="card">
      <div className="card-head">
        <h2>
          {t("w_fr_title")} <span className="small muted">{list.length}</span>
        </h2>
        <Link className="btn btn-sm" href="/friends?tab=add">
          {t("w_fr_add_btn")}
        </Link>
      </div>
      {list.length === 0 ? (
        <div className="empty">
          <h3>{t("w_fr_empty_title")}</h3>
          <p>{t("w_fr_empty_text")}</p>
        </div>
      ) : (
        <ul className="fr-list">
          {list.map(({ user: friend, since: at }) => (
            <li key={friend.userId}>
              <Link className="fr-row fr-link" href={`/friends/${friend.userId}`}>
                {avatar(friend)}
                {who(
                  friend,
                  shared.get(friend.userId)
                    ? tn(lang, "w_fr_shared", shared.get(friend.userId)!)
                    : t("w_fr_since", { date: since(at) }),
                )}
                <IconChevronRight className="muted" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  const requestsPanel = (
    <div className="split">
      <div className="split-main split-stack">
        <section className="card">
          <h2>{t("w_fr_incoming")}</h2>
          {incoming.length === 0 && invites.length === 0 && asks.length === 0 ? (
            <p className="small muted">{t("w_fr_incoming_empty")}</p>
          ) : (
            <ul className="fr-list">
              {incoming.map(({ request, from }) => (
                <li className="fr-row" key={`r${request.id}`}>
                  {avatar(from)}
                  {who(from, t("w_fr_wants"))}
                  <div className="fr-actions">
                    <form action={answerRequestAction}>
                      <input type="hidden" name="id" value={request.id} />
                      <input type="hidden" name="accept" value="1" />
                      <button className="btn btn-sm btn-primary" type="submit">
                        {t("w_fr_accept")}
                      </button>
                    </form>
                    <form action={answerRequestAction}>
                      <input type="hidden" name="id" value={request.id} />
                      <input type="hidden" name="accept" value="0" />
                      <button className="btn btn-sm btn-quiet" type="submit">
                        {t("w_fr_decline")}
                      </button>
                    </form>
                  </div>
                </li>
              ))}
              {invites.map(({ invite, from, chat }) => (
                <li className="fr-row" key={`i${invite.id}`}>
                  {avatar(from)}
                  {who(from, t("w_fr_invites_you", { group: chat.title }))}
                  <div className="fr-actions">
                    <form action={answerInviteAction}>
                      <input type="hidden" name="id" value={invite.id} />
                      <input type="hidden" name="accept" value="1" />
                      <button className="btn btn-sm btn-primary" type="submit">
                        {t("w_fr_join")}
                      </button>
                    </form>
                    <form action={answerInviteAction}>
                      <input type="hidden" name="id" value={invite.id} />
                      <input type="hidden" name="accept" value="0" />
                      <button className="btn btn-sm btn-quiet" type="submit">
                        {t("w_fr_refuse")}
                      </button>
                    </form>
                  </div>
                </li>
              ))}
              {asks.map(({ invite, from, chat }) => (
                <li className="fr-row" key={`a${invite.id}`}>
                  {avatar(from)}
                  {who(from, t("w_fr_asks_in", { group: chat.title }))}
                  <div className="fr-actions">
                    <form action={answerInviteAction}>
                      <input type="hidden" name="id" value={invite.id} />
                      <input type="hidden" name="accept" value="1" />
                      <button className="btn btn-sm btn-primary" type="submit">
                        {t("w_fr_let_in")}
                      </button>
                    </form>
                    <form action={answerInviteAction}>
                      <input type="hidden" name="id" value={invite.id} />
                      <input type="hidden" name="accept" value="0" />
                      <button className="btn btn-sm btn-quiet" type="submit">
                        {t("w_fr_refuse")}
                      </button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <section className="card split-side">
        <h2>{t("w_fr_outgoing")}</h2>
        {outgoing.length === 0 ? (
          <p className="small muted">{t("w_fr_outgoing_empty")}</p>
        ) : (
          <ul className="fr-list">
            {outgoing.map(({ request, to }) => (
              <li className="fr-row" key={request.id}>
                {avatar(to, 32)}
                {who(to, t("w_fr_waits"))}
                <form action={cancelRequestAction} className="fr-actions">
                  <input type="hidden" name="id" value={request.id} />
                  <button className="btn btn-sm btn-quiet" type="submit">
                    {t("w_fr_cancel")}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );

  /** Найденный по нику человек и что с ним можно сделать. */
  const found =
    search?.code === "found" ? (
      <div className="fr-row fr-found">
        {avatar(search.user)}
        {who(search.user)}
        <div className="fr-actions">
          {search.rel.friends ? (
            <Link className="btn btn-sm" href={`/friends/${search.user.userId}`}>
              {t("w_fr_open_card")}
            </Link>
          ) : search.rel.blockedByMe ? (
            <form action={unblockUserAction}>
              <input type="hidden" name="user_id" value={search.user.userId} />
              <button className="btn btn-sm" type="submit">
                {t("w_fr_unblock")}
              </button>
            </form>
          ) : search.rel.outgoing ? (
            <span className="badge">{t("w_fr_waits")}</span>
          ) : (
            <form action={requestFriendAction}>
              <input type="hidden" name="username" value={search.user.username ?? ""} />
              <input type="hidden" name="next" value={`/friends?tab=add&q=${encodeURIComponent(q)}`} />
              <button className="btn btn-sm btn-primary" type="submit">
                {search.rel.incoming ? t("w_fr_accept") : t("w_fr_add")}
              </button>
            </form>
          )}
        </div>
      </div>
    ) : search ? (
      <p className="small muted fr-search-note" role="status">
        {t(`w_fr_search_${search.code}`)}
      </p>
    ) : null;

  const addPanel = (
    <div className="split">
      <section className="card split-main">
        <h2>{t("w_fr_search_title")}</h2>
        <p className="small muted">{t("w_fr_search_lead")}</p>
        <form method="get" action="/friends" className="fr-search">
          <input type="hidden" name="tab" value="add" />
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder={t("w_fr_search_ph")}
            aria-label={t("w_fr_search_ph")}
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            maxLength={64}
            required
          />
          <button className="btn" type="submit">
            {t("w_fr_search_btn")}
          </button>
        </form>
        {found}
      </section>
      <section className="card split-side fr-link-card">
        <h2>{t("w_fr_link_title")}</h2>
        <p className="small muted">{t("w_fr_link_lead")}</p>
        <div className="invite-qr">
          <QrCode value={linkUrl} label={t("w_fr_link_qr", { name: displayName(me) })} />
          <div className="invite-qr-text">
            <div className="row invite-row">
              <input type="text" readOnly value={linkUrl} aria-label={t("w_fr_link_title")} />
              <CopyButton value={linkUrl} label={t("w_copy")} copiedLabel={t("w_copied")} />
            </div>
            {telegramLink && (
              <CopyButton value={telegramLink} label={t("w_fr_link_tg")} copiedLabel={t("w_copied")} small />
            )}
          </div>
        </div>
        <form action={rotateFriendCodeAction} className="fr-rotate">
          <ConfirmSubmit className="btn btn-sm btn-quiet" confirm={t("w_fr_link_rotate_confirm")}>
            {t("w_fr_link_rotate")}
          </ConfirmSubmit>
        </form>
      </section>
    </div>
  );

  const privacyPanel = (
    <div className="split">
      <section className="card split-main">
        <h2>{t("w_fr_privacy_title")}</h2>
        <form action={saveFriendSettingsAction} className="fr-settings">
          <label className="checkbox">
            <input type="checkbox" name="friends_see_groups" defaultChecked={me.friendsSeeGroups} />
            <span>
              {t("w_fr_set_groups")}
              <span className="small muted fr-hint">{t("w_fr_set_groups_hint")}</span>
            </span>
          </label>
          <label className="checkbox">
            <input type="checkbox" name="friends_see_free" defaultChecked={me.friendsSeeFree} />
            <span>
              {t("w_fr_set_free")}
              <span className="small muted fr-hint">{t("w_fr_set_free_hint")}</span>
            </span>
          </label>
          <label className="checkbox">
            <input type="checkbox" name="findable" defaultChecked={me.findable} />
            <span>
              {t("w_fr_set_findable")}
              <span className="small muted fr-hint">{t("w_fr_set_findable_hint")}</span>
            </span>
          </label>
          {myGroups.length > 0 && (
            <fieldset className="field fr-hide">
              <legend className="label">{t("w_fr_hide_title")}</legend>
              {myGroups.map((group) => (
                <label className="checkbox" key={group.chatId}>
                  <input type="checkbox" name="hidden" value={group.chatId} defaultChecked={group.hidden} />
                  <span>{group.title}</span>
                </label>
              ))}
            </fieldset>
          )}
          <button className="btn btn-primary" type="submit">
            {t("w_save")}
          </button>
        </form>
      </section>
      <section className="card split-side">
        <h2>{t("w_fr_blocked_title")}</h2>
        {blocked.length === 0 ? (
          <p className="small muted">{t("w_fr_blocked_empty")}</p>
        ) : (
          <ul className="fr-list">
            {blocked.map((person) => (
              <li className="fr-row" key={person.userId}>
                {avatar(person, 32)}
                {who(person)}
                <form action={unblockUserAction} className="fr-actions">
                  <input type="hidden" name="user_id" value={person.userId} />
                  <button className="btn btn-sm btn-quiet" type="submit">
                    {t("w_fr_unblock")}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );

  return (
    <>
      <Topbar lang={lang} />
      <main className="wrap fr-page">
        <header className="page-head">
          <div>
            <p className="eyebrow">{t("w_fr_eyebrow")}</p>
            <h1>{t("w_fr_title")}</h1>
          </div>
          <div className="page-head-side">
            <span className="small muted">{tn(lang, "w_fr_count", list.length)}</span>
          </div>
        </header>
        <FlashToast message={flash.message} tone={flash.tone} params={["fr"]} />
        <PageTabs
          label={t("w_fr_title")}
          initial={initial}
          tabs={[
            { key: "friends", label: t("w_fr_tab_friends") },
            { key: "requests", label: t("w_fr_tab_requests"), badge: waiting },
            { key: "add", label: t("w_fr_tab_add") },
            { key: "privacy", label: t("w_fr_tab_privacy") },
          ]}
          panels={{ friends: friendsPanel, requests: requestsPanel, add: addPanel, privacy: privacyPanel }}
        />
      </main>
    </>
  );
}
