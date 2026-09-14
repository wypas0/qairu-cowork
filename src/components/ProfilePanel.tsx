"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { logoutAction } from "@/app/login/actions";
import { joinByLinkAction, leaveGroupAction } from "@/app/profile/actions";

export type ProfileGroup = { chatId: number; slug: string; title: string };
export type ProfileMeeting = {
  id: number;
  chatSlug: string;
  chatTitle: string;
  place: string;
  whenText: string;
  goal: string;
};

export type ProfileLabels = {
  profile: string;
  close: string;
  myGroups: string;
  noGroups: string;
  leave: string;
  leaveConfirm: string; // содержит литеральный «{title}»
  meetings: string;
  noMeetings: string;
  joinOther: string;
  joinOtherPh: string;
  joinOtherBtn: string;
  anon: string;
  account: string;
  login: string;
  logout: string;
};

/**
 * Кнопка в левом верхнем углу шапки и панель профиля: свои группы (выйти),
 * ближайшие встречи по всем группам, вход в ещё одну группу по ссылке.
 *
 * На узких экранах панель — шторка снизу (верх скруглён, низ заподлицо с
 * краем экрана); на широких — выезжает слева, заподлицо с левым краем.
 * Радиус углов панели поэтому зависит от того, у какого края экрана она
 * стоит, а не подобран произвольно.
 */
export function ProfilePanel({
  userName,
  groups,
  meetings,
  labels,
}: {
  userName: string | null;
  groups: ProfileGroup[];
  meetings: ProfileMeeting[];
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
        <div className="profile-overlay" onClick={() => setOpen(false)}>
          <div
            className="profile-panel"
            role="dialog"
            aria-modal="true"
            aria-label={labels.profile}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="profile-head">
              <h2>{userName ? `${labels.profile} · ${userName}` : labels.profile}</h2>
              <button
                type="button"
                className="btn btn-sm btn-quiet"
                onClick={() => setOpen(false)}
              >
                {labels.close}
              </button>
            </div>

            {!userName ? (
              <>
                <p className="muted small">{labels.anon}</p>
                <Link className="btn btn-primary" href="/login" onClick={() => setOpen(false)}>
                  {labels.login}
                </Link>
              </>
            ) : (
              <>
                <section className="profile-section">
                  <h3>{labels.myGroups}</h3>
                  {groups.length === 0 && <p className="muted small">{labels.noGroups}</p>}
                  <ul className="profile-groups">
                    {groups.map((group) => (
                      <li className="profile-group-row" key={group.chatId}>
                        <Link
                          className="chip ok"
                          href={`/g/${group.slug}`}
                          onClick={() => setOpen(false)}
                        >
                          {group.title}
                        </Link>
                        <form
                          action={leaveGroupAction.bind(null, group.slug)}
                          onSubmit={(event) => {
                            if (!window.confirm(labels.leaveConfirm.replace("{title}", group.title))) {
                              event.preventDefault();
                            }
                          }}
                        >
                          <button className="btn btn-sm btn-quiet btn-danger" type="submit">
                            {labels.leave}
                          </button>
                        </form>
                      </li>
                    ))}
                  </ul>
                </section>

                <section className="profile-section">
                  <h3>{labels.meetings}</h3>
                  {meetings.length === 0 && <p className="muted small">{labels.noMeetings}</p>}
                  {meetings.length > 0 && (
                    <ul className="windows">
                      {meetings.map((meeting) => (
                        <li key={meeting.id}>
                          <Link
                            href={`/g/${meeting.chatSlug}`}
                            onClick={() => setOpen(false)}
                            style={{ textDecoration: "none" }}
                          >
                            <span className="when">{meeting.goal || meeting.whenText || "—"}</span>{" "}
                            <span className="small muted">
                              {meeting.chatTitle}
                              {meeting.place ? ` · ${meeting.place}` : ""}
                              {meeting.whenText ? ` · ${meeting.whenText}` : ""}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="profile-section">
                  <h3>{labels.joinOther}</h3>
                  <form action={joinByLinkAction} className="row">
                    <input type="text" name="link" placeholder={labels.joinOtherPh} required />
                    <button className="btn btn-sm" type="submit" style={{ flex: "0 0 auto" }}>
                      {labels.joinOtherBtn}
                    </button>
                  </form>
                </section>

                <section className="profile-section votes">
                  <Link className="btn btn-sm" href="/account" onClick={() => setOpen(false)}>
                    {labels.account}
                  </Link>
                  <form action={logoutAction}>
                    <button className="btn btn-sm btn-quiet" type="submit">
                      {labels.logout}
                    </button>
                  </form>
                </section>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
