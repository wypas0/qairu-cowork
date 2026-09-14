"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { logoutAction } from "@/app/login/actions";
import { joinByLinkAction, leaveGroupAction } from "@/app/profile/actions";

export type ProfileGroup = { chatId: number; slug: string; title: string };

export type ProfileUser = {
  name: string;
  /** @username из Telegram — только у подтверждённых Telegram-аккаунтов. */
  telegram: string | null;
  /** Логин для входа по паролю, если задан. */
  login: string | null;
};

export type ProfileLabels = {
  profile: string;
  close: string;
  myGroups: string;
  noGroups: string;
  leaveGroup: string; // подпись кнопки для скринридера, содержит «{title}»
  leaveConfirm: string; // содержит литеральный «{title}»
  joinPh: string;
  joinBtn: string;
  createGroup: string;
  anon: string;
  account: string;
  login: string;
  logout: string;
  loginLabel: string; // «логин: {login}»
};

/**
 * Кнопка в левом верхнем углу шапки и панель профиля.
 *
 * Сверху — кто ты, дальше — все твои группы, под ними вход в ещё одну группу
 * и создание новой, внизу — логин и пароль и выход.
 *
 * На узких экранах панель — шторка снизу (верх скруглён, низ заподлицо с
 * краем экрана); на широких — выезжает слева, заподлицо с левым краем.
 */
export function ProfilePanel({
  user,
  groups,
  labels,
}: {
  user: ProfileUser | null;
  groups: ProfileGroup[];
  labels: ProfileLabels;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const close = () => setOpen(false);
  const subtitle = user
    ? [user.telegram ? `@${user.telegram}` : null, user.login ? labels.loginLabel.replace("{login}", user.login) : null]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <>
      <button
        type="button"
        className="icon-btn"
        aria-label={labels.profile}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="2" />
          <path
            d="M4 20c1.6-3.8 5-6 8-6s6.4 2.2 8 6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </button>

      {open && (
        <div className="profile-overlay" onClick={close}>
          <div
            className="profile-panel"
            role="dialog"
            aria-modal="true"
            aria-label={labels.profile}
            onClick={(event) => event.stopPropagation()}
          >
            {/* ============ кто ты ============ */}
            <div className="pp-head">
              <span className="pp-avatar" aria-hidden="true">
                {(user?.name.trim()[0] ?? "?").toUpperCase()}
              </span>
              <div className="pp-who">
                <b>{user ? user.name : labels.profile}</b>
                {subtitle && <span className="small muted">{subtitle}</span>}
              </div>
              <button type="button" className="pp-close" aria-label={labels.close} onClick={close}>
                ×
              </button>
            </div>

            {!user && (
              <>
                <p className="muted small">{labels.anon}</p>
                <Link className="btn btn-primary pp-wide" href="/login" onClick={close}>
                  {labels.login}
                </Link>
              </>
            )}

            {/* ============ группы ============ */}
            {user && (
              <section className="pp-section">
                <h3 className="pp-title">
                  {labels.myGroups} <span className="muted">{groups.length}</span>
                </h3>
                {groups.length === 0 ? (
                  <p className="muted small">{labels.noGroups}</p>
                ) : (
                  <ul className="pp-groups">
                    {groups.map((group) => (
                      <li key={group.chatId}>
                        <Link className="pp-group" href={`/g/${group.slug}`} onClick={close}>
                          <span className="pp-group-mark" aria-hidden="true">
                            {(group.title.trim()[0] ?? "#").toUpperCase()}
                          </span>
                          <span className="pp-group-title">{group.title}</span>
                        </Link>
                        <form
                          action={leaveGroupAction.bind(null, group.slug)}
                          onSubmit={(event) => {
                            if (!window.confirm(labels.leaveConfirm.replace("{title}", group.title))) {
                              event.preventDefault();
                            }
                          }}
                        >
                          <button
                            className="pp-leave"
                            type="submit"
                            aria-label={labels.leaveGroup.replace("{title}", group.title)}
                            title={labels.leaveGroup.replace("{title}", group.title)}
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                              <path
                                d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </button>
                        </form>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {/* ============ добавить группу ============ */}
            <section className="pp-section">
              <form action={joinByLinkAction} className="pp-join">
                <input
                  type="text"
                  name="link"
                  placeholder={labels.joinPh}
                  aria-label={labels.joinPh}
                  required
                />
                <button className="btn btn-sm" type="submit">
                  {labels.joinBtn}
                </button>
              </form>
              <Link className="btn btn-sm btn-quiet pp-wide" href="/#create" onClick={close}>
                + {labels.createGroup}
              </Link>
            </section>

            {/* ============ аккаунт ============ */}
            {user && (
              <div className="pp-foot">
                <Link className="btn btn-sm btn-quiet" href="/account" onClick={close}>
                  {labels.account}
                </Link>
                <form action={logoutAction}>
                  <button className="btn btn-sm btn-quiet btn-danger" type="submit">
                    {labels.logout}
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
