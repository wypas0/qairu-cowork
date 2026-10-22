import Link from "next/link";

import { FlashToast } from "@/components/FlashToast";
import { PersonAvatar } from "@/components/friends/PersonAvatar";
import { Topbar } from "@/components/Topbar";
import * as repo from "@/db/repo";
import { displayName } from "@/db/schema";
import { translator } from "@/i18n";
import { currentUser } from "@/lib/auth";
import * as friends from "@/lib/friends";
import { loginUrl } from "@/lib/gate";
import { addByLinkAction } from "../../friends/actions";
import { friendFlash } from "../../friends/flash";

export const dynamic = "force-dynamic";

/**
 * Личная ссылка «добавь меня в друзья» (/f/<код>, QR, startapp=f_<код>).
 *
 * Показывает, чья это ссылка, и одну кнопку. Устаревшая ссылка и ссылка
 * человека, который заблокировал пришедшего, выглядят одинаково — «не
 * работает»: о блокировке не узнать.
 */
export default async function FriendLinkPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { code } = await params;
  const query = await searchParams;
  const viewer = await currentUser();
  const lang = viewer?.lang ?? "ru";
  const t = translator(lang);
  const path = `/f/${encodeURIComponent(code)}`;

  const owner = await friends.linkOwner(code);
  const rel = owner && viewer && !viewer.isWeb ? await friends.relationOf(viewer.userId, owner.userId) : null;
  const usable = owner && !rel?.blockedMe;
  const avatar = usable ? await repo.avatarVersion(owner.userId) : null;
  const flash = friendFlash(t, query.fr);

  return (
    <>
      <Topbar lang={lang} />
      <main className="wrap">
        <FlashToast message={flash.message} tone={flash.tone} params={["fr"]} />
        <section className="card fr-link-page">
          {!usable ? (
            <>
              <h1>{t("w_fr_link_dead_title")}</h1>
              <p className="muted">{t("w_fr_link_dead_text")}</p>
              <Link className="btn" href="/">
                {t("w_fr_link_home")}
              </Link>
            </>
          ) : (
            <>
              <PersonAvatar user={owner} version={avatar} size={88} />
              <p className="eyebrow">{t("w_fr_link_eyebrow")}</p>
              <h1>{displayName(owner)}</h1>
              {owner.username && <p className="small muted">@{owner.username}</p>}
              {!viewer || viewer.isWeb ? (
                <>
                  <p className="muted">{t("w_fr_link_login_lead")}</p>
                  <Link className="btn btn-primary" href={loginUrl(path)}>
                    {t("w_login_btn")}
                  </Link>
                </>
              ) : rel?.self ? (
                <>
                  <p className="muted">{t("w_fr_link_self")}</p>
                  <Link className="btn" href="/friends?tab=add">
                    {t("w_fr_title")}
                  </Link>
                </>
              ) : rel?.friends ? (
                <>
                  <p className="muted">{t("w_fr_flash_already")}</p>
                  <Link className="btn" href={`/friends/${owner.userId}`}>
                    {t("w_fr_open_card")}
                  </Link>
                </>
              ) : (
                <>
                  <p className="muted">{t("w_fr_link_lead_add")}</p>
                  <form action={addByLinkAction}>
                    <input type="hidden" name="code" value={code} />
                    <button className="btn btn-primary" type="submit">
                      {t("w_fr_add")}
                    </button>
                  </form>
                </>
              )}
            </>
          )}
        </section>
      </main>
    </>
  );
}
