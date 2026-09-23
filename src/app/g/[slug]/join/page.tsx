import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { TelegramSignIn } from "@/components/TelegramSignIn";
import { Topbar } from "@/components/Topbar";
import * as repo from "@/db/repo";
import { displayName } from "@/db/schema";
import { translator } from "@/i18n";
import { afterJoinPath } from "@/lib/afterJoin";
import { pageUser } from "@/lib/gate";
import { isOwnOrDirect } from "@/lib/secFetch";

import { joinGroup } from "../actions";

export const dynamic = "force-dynamic";

/**
 * Превью ссылки-приглашения в чате: «Присоединиться к группе «ИС-21»» на языке
 * группы. Робот мессенджера приходит без входа и попадает именно сюда —
 * страница группы отправляет посторонних на приглашение. Поисковикам
 * приглашение не нужно: название группы незачем находить в выдаче.
 */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const robots = { index: false, follow: false };
  const chat = await repo.getChatBySlug((await params).slug);
  if (!chat) return { robots };
  const t = translator(chat.lang);
  const title = t("w_join_title", { title: chat.title });
  const description = t("w_join_preview");
  return {
    title,
    description,
    robots,
    // Свой openGraph целиком заменяет корневой — картинку превью указываем заново.
    openGraph: {
      type: "website",
      siteName: "QairuCowork",
      title,
      description,
      images: [{ url: "/opengraph-image", width: 1200, height: 630 }],
    },
  };
}

export default async function JoinPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const chat = await repo.getChatBySlug(slug);
  if (!chat) notFound();

  const t = translator(chat.lang);
  const user = await pageUser(`/g/${slug}/join`);
  if (user) {
    if (await repo.isMember(chat.chatId, user.userId)) redirect(`/g/${slug}`);
    // Ссылка или код уже и есть согласие вступить: бот по такой же ссылке
    // добавляет в группу сразу, второй кнопки нет. Но только когда ссылку
    // открыл сам человек или он пришёл с нашего сайта — иначе чужая страница
    // могла бы тихо записать его в свою группу (см. isOwnOrDirect).
    if (isOwnOrDirect(await headers())) {
      await repo.addMembership(chat.chatId, user.userId);
      redirect(await afterJoinPath(slug, user));
    }

    return (
      <>
        <Topbar lang={chat.lang} />
        <main className="wrap">
          <div className="card" style={{ maxWidth: 520, margin: "32px auto" }}>
            <h1 style={{ fontSize: 22 }}>{t("w_join_title", { title: chat.title })}</h1>
            <p className="muted small">{t("w_join_confirm_lead", { name: displayName(user) })}</p>
            <form action={joinGroup.bind(null, slug)}>
              <button type="submit" className="btn btn-primary">
                {t("w_join_btn")}
              </button>
            </form>
          </div>
        </main>
      </>
    );
  }

  // Посторонним — только сколько человек в группе, без имён.
  const count = (await repo.chatMembers(chat.chatId)).length;

  return (
    <>
      <Topbar lang={chat.lang} />
      <main className="wrap">
        <div className="card" style={{ maxWidth: 520, margin: "32px auto" }}>
          <h1 style={{ fontSize: 22 }}>{t("w_join_title", { title: chat.title })}</h1>
          <p className="muted small">{t("w_join_lead")}</p>

          {count > 0 && <p className="small muted">{t("w_already_in", { count })}</p>}

          {/* После входа человек вернётся сюда и сразу окажется в группе.
              В Mini App вход и вступление произойдут сами (см. TelegramAuth). */}
          <TelegramSignIn lang={chat.lang} next={`/g/${slug}/join`} />
          <p className="small muted" style={{ marginTop: 10 }}>
            {t("w_signin_hint")}
          </p>
        </div>
      </main>
    </>
  );
}
