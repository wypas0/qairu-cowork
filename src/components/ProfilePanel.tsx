"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { logoutAction } from "@/app/login/actions";
import { joinByLinkAction, leaveGroupAction } from "@/app/profile/actions";

export type ProfileGroup = { chatId: number; slug: string; title: string };

export type ProfileUser = {
  name: string;
  /** @username из Telegram — только у подтверждённых Telegram-аккаунтов. */
  telegram: string | null;
  /** Логин для входа по паролю, если задан. */
  login: string | null;
  /** Адрес фото профиля с версией, если фото загружено. */
  avatarUrl: string | null;
};

export type ProfileLabels = {
  profile: string;
  close: string;
  back: string;
  myGroups: string;
  noGroups: string;
  leaveGroup: string; // содержит «{title}»
  leaveConfirm: string; // содержит «{title}»
  joinPh: string;
  joinBtn: string;
  createGroup: string;
  anon: string;
  login: string;
  loginLabel: string; // «логин {login}»
  account: string;
  openAccount: string;
  photo: string;
  changePhoto: string;
  removePhoto: string;
  photoError: string;
  photoTooLarge: string;
  credentials: string;
  credentialsSet: string; // «логин {login}»
  credentialsUnset: string;
  logout: string;
};

/** Сторона квадрата, до которого браузер ужимает фото перед загрузкой. */
const AVATAR_SIZE = 256;

/**
 * Обрезать картинку по центру до квадрата и ужать до 256×256.
 * WebP, если браузер умеет его кодировать, иначе JPEG.
 */
async function squareDataUrl(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("decode"));
      element.src = url;
    });
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    if (!side) throw new Error("empty");
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_SIZE;
    canvas.height = AVATAR_SIZE;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas");
    context.imageSmoothingQuality = "high";
    context.drawImage(
      image,
      (image.naturalWidth - side) / 2,
      (image.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      AVATAR_SIZE,
      AVATAR_SIZE,
    );
    const webp = canvas.toDataURL("image/webp", 0.85);
    return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function Avatar({ name, url, className }: { name: string; url: string | null; className: string }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element -- своё маленькое фото, оптимизатор Next не нужен
    <img className={className} src={url} alt="" width={AVATAR_SIZE} height={AVATAR_SIZE} />
  ) : (
    <span className={className} aria-hidden="true">
      {(name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

/**
 * Кнопка профиля в шапке и панель.
 *
 * Главный экран: кто ты (нажатие открывает аккаунт), все группы, вход в группу
 * по ссылке и создание новой. Экран аккаунта: фото профиля, логин и пароль,
 * выход из аккаунта.
 *
 * На узких экранах панель — шторка снизу, на широких — выезжает слева.
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
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"main" | "account">("main");
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? null);
  const [busy, setBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => setAvatarUrl(user?.avatarUrl ?? null), [user?.avatarUrl]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // Esc на экране аккаунта сначала возвращает назад, потом закрывает панель.
      if (viewRef.current === "account") setView("main");
      else setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    setView("main");
    setPhotoError(null);
  };

  async function uploadPhoto(file: File) {
    setBusy(true);
    setPhotoError(null);
    try {
      const image = await squareDataUrl(file);
      const response = await fetch("/api/avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ image }),
      });
      const data = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !data.url) {
        setPhotoError(data.error === "too_large" ? labels.photoTooLarge : labels.photoError);
        return;
      }
      setAvatarUrl(data.url);
      router.refresh();
    } catch {
      setPhotoError(labels.photoError);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removePhoto() {
    setBusy(true);
    setPhotoError(null);
    try {
      const response = await fetch("/api/avatar", { method: "DELETE", credentials: "same-origin" });
      if (!response.ok) throw new Error(String(response.status));
      setAvatarUrl(null);
      router.refresh();
    } catch {
      setPhotoError(labels.photoError);
    } finally {
      setBusy(false);
    }
  }

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
        {user && avatarUrl ? (
          <Avatar name={user.name} url={avatarUrl} className="icon-avatar" />
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="2" />
            <path
              d="M4 20c1.6-3.8 5-6 8-6s6.4 2.2 8 6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        )}
      </button>

      {open && (
        <div className="profile-overlay" onClick={close}>
          <div
            className="profile-panel"
            role="dialog"
            aria-modal="true"
            aria-label={view === "account" ? labels.account : labels.profile}
            onClick={(event) => event.stopPropagation()}
          >
            {view === "account" && user ? (
              /* ======================== экран аккаунта ======================== */
              <>
                <div className="pp-head">
                  <button
                    type="button"
                    className="pp-close"
                    aria-label={labels.back}
                    onClick={() => {
                      setView("main");
                      setPhotoError(null);
                    }}
                  >
                    ‹
                  </button>
                  <div className="pp-who">
                    <b>{labels.account}</b>
                  </div>
                  <button type="button" className="pp-close" aria-label={labels.close} onClick={close}>
                    ×
                  </button>
                </div>

                <section className="pp-section pp-photo">
                  <Avatar name={user.name} url={avatarUrl} className="pp-avatar pp-avatar-lg" />
                  <b className="pp-photo-name">{user.name}</b>
                  {subtitle && <span className="small muted">{subtitle}</span>}
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    hidden
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void uploadPhoto(file);
                    }}
                  />
                  <div className="pp-photo-actions">
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={busy}
                      onClick={() => fileRef.current?.click()}
                    >
                      {labels.changePhoto}
                    </button>
                    {avatarUrl && (
                      <button
                        type="button"
                        className="btn btn-sm btn-quiet btn-danger"
                        disabled={busy}
                        onClick={() => void removePhoto()}
                      >
                        {labels.removePhoto}
                      </button>
                    )}
                  </div>
                  {photoError && (
                    <p className="small" role="alert" style={{ color: "var(--danger)", margin: 0 }}>
                      {photoError}
                    </p>
                  )}
                </section>

                <nav className="pp-menu" aria-label={labels.account}>
                  <Link className="pp-menu-item" href="/account" onClick={close}>
                    <span>
                      {labels.credentials}
                      <span className="small muted pp-menu-sub">
                        {user.login
                          ? labels.credentialsSet.replace("{login}", user.login)
                          : labels.credentialsUnset}
                      </span>
                    </span>
                    <span aria-hidden="true">›</span>
                  </Link>
                  <form action={logoutAction}>
                    <button type="submit" className="pp-menu-item pp-danger">
                      <span>{labels.logout}</span>
                    </button>
                  </form>
                </nav>
              </>
            ) : (
              /* ======================== главный экран ======================== */
              <>
                <div className="pp-head">
                  {user ? (
                    <button
                      type="button"
                      className="pp-me"
                      onClick={() => setView("account")}
                      aria-label={labels.openAccount}
                    >
                      <Avatar name={user.name} url={avatarUrl} className="pp-avatar" />
                      <span className="pp-who">
                        <b>{user.name}</b>
                        {subtitle && <span className="small muted">{subtitle}</span>}
                      </span>
                      <span className="pp-chevron" aria-hidden="true">
                        ›
                      </span>
                    </button>
                  ) : (
                    <div className="pp-who">
                      <b>{labels.profile}</b>
                    </div>
                  )}
                  <button type="button" className="pp-close" aria-label={labels.close} onClick={close}>
                    ×
                  </button>
                </div>

                {!user && (
                  <section className="pp-section">
                    <p className="muted small">{labels.anon}</p>
                    <Link className="btn btn-primary pp-wide" href="/login" onClick={close}>
                      {labels.login}
                    </Link>
                  </section>
                )}

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
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
