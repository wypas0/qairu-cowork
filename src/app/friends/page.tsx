import Link from "next/link";
import { redirect } from "next/navigation";

import { miniAppFriendLink } from "@/bot/site";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { CopyButton } from "@/components/CopyButton";
import { FlashToast } from "@/components/FlashToast";
import { FriendsList } from "@/components/friends/FriendsList";
import { initials } from "@/components/friends/initials";
import { PersonAvatar } from "@/components/friends/PersonAvatar";
import { PrivacyForm } from "@/components/friends/PrivacyForm";
import { ShareButton } from "@/components/friends/ShareButton";
import { PageTabs, TabLink } from "@/components/PageTabs";
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
  undoDeclineAction,
} from "./actions";
import { friendFlash } from "./flash";
import { ago, rich } from "./format";

export const dynamic = "force-dynamic";

const TABS = ["friends", "requests", "add", "privacy"] as const;

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
  const ids = [...new Set(people.map((person) => person.userId))];
  const [avatars, shared] = await Promise.all([repo.avatarVersions(ids), repo.sharedGroupTitles(me.userId, ids)]);
  const avatar = (person: User, size?: number) => (
    <PersonAvatar user={person} version={avatars.get(person.userId)} size={size} />
  );
  /** Общий контекст — по нему понятно, знаешь ли человека: «общая группа «ИС-21»». */
  const sharedText = (person: User): string | null => {
    const titles = shared.get(person.userId) ?? [];
    if (titles.length === 0) return null;
    return titles.length === 1 ? t("w_fr_shared_group", { group: titles[0]! }) : tn(lang, "w_fr_shared", titles.length);
  };
  const nick = (person: User) => (person.username ? `@${person.username}` : null);
  const meta = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(" · ");

  const base = await baseUrl();
  const linkUrl = `${base}/f/${code}`;
  const telegramLink = hasBot() ? await miniAppFriendLink(code).catch(() => null) : null;

  const waiting = incoming.length + invites.length + asks.length;
  const requested = typeof query.tab === "string" ? query.tab : "";
  const initial = (TABS as readonly string[]).includes(requested) ? requested : waiting > 0 ? "requests" : "friends";
  const flash = friendFlash(t, query.fr);
  // «Вернуть» после отказа — заявка (fr) или приглашение (gi), см. answer*Action.
  const undo = typeof query.undo === "string" ? /^(fr|gi):(\d{1,10})$/.exec(query.undo) : null;
  const since = (at: Date) => formatDM(utcToZonedWall(at, tz).day);
  const when = (at: Date) => ago(lang, at, now, tz, t("w_fr_just_now"));

  /** Строка: фото, главная строка, пояснение под ней, действия справа. */
  const row = (key: string, person: User, main: React.ReactNode, note: string, actions: React.ReactNode, size?: number) => (
    <li className="fr-row" key={key}>
      {avatar(person, size)}
      <span className="fr-who">
        <span className="fr-main">{main}</span>
        {note && <span className="small muted">{note}</span>}
      </span>
      <div className="fr-actions">{actions}</div>
    </li>
  );
  /** Две кнопки ответа: главная и тихая. */
  const answer = (action: (formData: FormData) => Promise<void>, id: number, yes: string, no: string) => (
    <>
      <form action={action}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="accept" value="1" />
        <button className="btn btn-sm btn-primary" type="submit">
          {yes}
        </button>
      </form>
      <form action={action}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="accept" value="0" />
        <button className="btn btn-sm btn-quiet" type="submit">
          {no}
        </button>
      </form>
    </>
  );
  const group = (title: string) => <b>«{title}»</b>;

  const friendsPanel = (
    <section className="card">
      {list.length === 0 ? (
        <div className="empty">
          <h3>{t("w_fr_empty_title")}</h3>
          <p>{t("w_fr_empty_text")}</p>
          <div className="empty-actions">
            <TabLink tab="add" focus="#fr-find" className="btn btn-primary">
              {t("w_fr_empty_find")}
            </TabLink>
            <TabLink tab="add" focus="#my-link" className="btn">
              {t("w_fr_empty_qr")}
            </TabLink>
          </div>
        </div>
      ) : (
        <FriendsList
          rows={list.map(({ user: friend, since: at }) => ({
            id: friend.userId,
            name: displayName(friend),
            nick: nick(friend),
            note: sharedText(friend) ?? t("w_fr_since", { date: since(at) }),
            avatarUrl: avatars.get(friend.userId) ? `/api/avatar/${friend.userId}?v=${avatars.get(friend.userId)}` : null,
            initials: initials(displayName(friend)),
          }))}
          labels={{ filter: t("w_fr_filter_ph"), none: t("w_fr_filter_none") }}
        />
      )}
    </section>
  );

  const requestsPanel = (
    <div className="split">
      <div className="split-main split-stack">
        {waiting === 0 && (
          <section className="card">
            <div className="empty">
              <h3>{t("w_fr_incoming_empty")}</h3>
              <p>{t("w_fr_incoming_empty_text")}</p>
              <div className="empty-actions">
                <TabLink tab="add" focus="#fr-find" className="btn">
                  {t("w_fr_empty_find")}
                </TabLink>
              </div>
            </div>
          </section>
        )}
        {incoming.length > 0 && (
          <section className="card">
            <h2>
              {t("w_fr_sec_requests")} <span className="small muted">{incoming.length}</span>
            </h2>
            <ul className="fr-list">
              {incoming.map(({ request, from }) =>
                row(
                  `r${request.id}`,
                  from,
                  <b>{displayName(from)}</b>,
                  meta(nick(from), sharedText(from), when(request.createdAt)),
                  answer(answerRequestAction, request.id, t("w_fr_accept"), t("w_fr_decline")),
                ),
              )}
            </ul>
          </section>
        )}
        {invites.length > 0 && (
          <section className="card">
            <h2>
              {t("w_fr_sec_invites")} <span className="small muted">{invites.length}</span>
            </h2>
            <ul className="fr-list">
              {invites.map(({ invite, from, chat }) =>
                row(
                  `i${invite.id}`,
                  from,
                  rich(t("w_fr_line_invite"), { name: <b>{displayName(from)}</b>, group: group(chat.title) }),
                  meta(nick(from), when(invite.createdAt)),
                  answer(answerInviteAction, invite.id, t("w_fr_join"), t("w_fr_refuse")),
                ),
              )}
            </ul>
          </section>
        )}
        {asks.length > 0 && (
          <section className="card">
            <h2>
              {t("w_fr_sec_asks")} <span className="small muted">{asks.length}</span>
            </h2>
            <ul className="fr-list">
              {asks.map(({ invite, from, chat }) =>
                row(
                  `a${invite.id}`,
                  from,
                  rich(t("w_fr_line_ask"), { name: <b>{displayName(from)}</b>, group: group(chat.title) }),
                  meta(nick(from), sharedText(from), when(invite.createdAt)),
                  answer(answerInviteAction, invite.id, t("w_fr_let_in"), t("w_fr_refuse")),
                ),
              )}
            </ul>
          </section>
        )}
      </div>
      <section className="card split-side">
        <h2>{t("w_fr_outgoing")}</h2>
        {outgoing.length === 0 ? (
          <p className="small muted">{t("w_fr_outgoing_empty")}</p>
        ) : (
          <ul className="fr-list">
            {outgoing.map(({ request, to }) =>
              row(
                `o${request.id}`,
                to,
                <b>{displayName(to)}</b>,
                meta(nick(to), t("w_fr_waits"), when(request.createdAt)),
                <form action={cancelRequestAction}>
                  <input type="hidden" name="id" value={request.id} />
                  <button className="btn btn-sm btn-quiet" type="submit">
                    {t("w_fr_cancel")}
                  </button>
                </form>,
                32,
              ),
            )}
          </ul>
        )}
      </section>
    </div>
  );

  /** Найденный по нику человек и что с ним можно сделать. */
  const found =
    search?.code === "found" ? (
      <ul className="fr-list fr-found">
        {row(
          "found",
          search.user,
          <b>{displayName(search.user)}</b>,
          meta(nick(search.user), sharedText(search.user)),
          search.rel.friends ? (
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
          ),
        )}
      </ul>
    ) : null;
  const searchNote =
    search && search.code !== "found" ? (
      <p className={`small fr-field-note${search.code === "none" ? " muted" : " fr-field-error"}`} id="fr-find-note" role="status">
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
          <div className="fr-at-field">
            <span aria-hidden="true">@</span>
            <input
              id="fr-find"
              type="text"
              name="q"
              defaultValue={q.replace(/^@/, "")}
              placeholder={t("w_fr_search_ph")}
              aria-label={t("w_fr_search_ph")}
              aria-describedby={searchNote ? "fr-find-note" : undefined}
              aria-invalid={search?.code === "bad" || undefined}
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              maxLength={64}
              required
            />
          </div>
          <button className="btn" type="submit">
            {t("w_fr_search_btn")}
          </button>
        </form>
        {searchNote}
        {found}
      </section>
      <section className="card split-side fr-link-card" id="my-link" tabIndex={-1}>
        <h2>{t("w_fr_link_title")}</h2>
        <p className="small muted">{t("w_fr_link_lead")}</p>
        <div className="fr-link-body">
          <QrCode value={linkUrl} label={t("w_fr_link_qr", { name: displayName(me) })} />
          <div className="fr-link-side">
            <p className="fr-link-url">{linkUrl}</p>
            <div className="fr-link-actions">
              <ShareButton
                url={linkUrl}
                telegramUrl={telegramLink}
                text={t("w_fr_share_text")}
                title="QairuCowork"
                label={t("w_fr_share")}
                copied={t("w_copied")}
                className="btn btn-sm btn-primary"
              />
              <CopyButton value={linkUrl} label={t("w_fr_link_copy")} copiedLabel={t("w_copied")} small />
            </div>
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
        <PrivacyForm
          action={saveFriendSettingsAction}
          initial={{ seeGroups: me.friendsSeeGroups, seeFree: me.friendsSeeFree, findable: me.findable }}
          groups={myGroups.map((entry) => ({ chatId: entry.chatId, title: entry.title, visible: !entry.hidden }))}
          labels={{
            seeGroups: t("w_fr_set_groups"),
            seeGroupsHint: t("w_fr_set_groups_hint"),
            seeFree: t("w_fr_set_free"),
            seeFreeHint: t("w_fr_set_free_hint"),
            findable: t("w_fr_set_findable"),
            findableHint: t("w_fr_set_findable_hint"),
            groupsTitle: t("w_fr_visible_title"),
            groupsOff: t("w_fr_visible_off"),
            save: t("w_save"),
          }}
        />
      </section>
      <section className="card split-side">
        <h2>{t("w_fr_blocked_title")}</h2>
        {blocked.length === 0 ? (
          <p className="small muted">{t("w_fr_blocked_empty")}</p>
        ) : (
          <ul className="fr-list">
            {blocked.map((person) =>
              row(
                `b${person.userId}`,
                person,
                <b>{displayName(person)}</b>,
                meta(nick(person)),
                <form action={unblockUserAction}>
                  <input type="hidden" name="user_id" value={person.userId} />
                  <button className="btn btn-sm btn-quiet" type="submit">
                    {t("w_fr_unblock")}
                  </button>
                </form>,
                32,
              ),
            )}
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
        </header>
        <FlashToast
          message={flash.message}
          tone={flash.tone}
          params={["fr", "undo"]}
          id={typeof query.undo === "string" ? query.undo : undefined}
          action={
            undo && query.fr === "declined"
              ? { label: t("w_fr_undo"), run: undoDeclineAction.bind(null, undo[1]!, Number(undo[2])) }
              : undefined
          }
        />
        <PageTabs
          label={t("w_fr_title")}
          initial={initial}
          tabs={[
            { key: "friends", label: t("w_fr_tab_friends"), count: list.length },
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
