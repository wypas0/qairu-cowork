import { notFound, redirect } from "next/navigation";

import { TelegramAuth } from "@/components/TelegramAuth";
import { Topbar } from "@/components/Topbar";
import * as repo from "@/db/repo";
import { displayName } from "@/db/schema";
import { translator } from "@/i18n";
import { currentUser } from "@/lib/auth";
import { joinGroup } from "../actions";

export const dynamic = "force-dynamic";

export default async function JoinPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const chat = await repo.getChatBySlug(slug);
  if (!chat) notFound();

  const user = await currentUser();
  if (user && (await repo.isMember(chat.chatId, user.userId))) redirect(`/g/${slug}`);

  const t = translator(chat.lang);
  const members = await repo.chatMembers(chat.chatId);

  return (
    <>
      {/* В Mini App человек уже опознан подписью — форму показывать не придётся. */}
      <TelegramAuth slug={slug} authed={false} />
      <Topbar />
      <main className="wrap">
        <div className="card" style={{ maxWidth: 520, margin: "32px auto" }}>
          <h1 style={{ fontSize: 22 }}>{t("w_join_title", { title: chat.title })}</h1>
          <p className="muted small">{t("w_join_lead")}</p>

          {members.length > 0 && (
            <>
              <p className="small muted">{t("w_already_in", { count: members.length })}:</p>
              <ul className="people" style={{ marginBottom: 14 }}>
                {members.map((member) => (
                  <li className="chip" key={member.userId}>
                    {displayName(member)}
                  </li>
                ))}
              </ul>
            </>
          )}

          <form action={joinGroup.bind(null, slug)}>
            <div className="field">
              <label htmlFor="name">{t("w_your_name")}</label>
              <input
                id="name"
                name="name"
                type="text"
                required
                maxLength={60}
                autoFocus
                defaultValue={user ? displayName(user) : ""}
                placeholder={t("w_your_name_ph")}
              />
            </div>
            <button className="btn btn-primary" type="submit">
              {t("w_join_btn")}
            </button>
          </form>
        </div>
      </main>
    </>
  );
}
