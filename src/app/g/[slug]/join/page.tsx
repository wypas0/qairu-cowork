import { notFound, redirect } from "next/navigation";

import { TelegramSignIn } from "@/components/TelegramSignIn";
import { Topbar } from "@/components/Topbar";
import * as repo from "@/db/repo";
import { displayName } from "@/db/schema";
import { translator } from "@/i18n";
import { afterJoinPath } from "@/lib/afterJoin";
import { pageUser } from "@/lib/gate";

export const dynamic = "force-dynamic";

export default async function JoinPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const chat = await repo.getChatBySlug(slug);
  if (!chat) notFound();

  const user = await pageUser(`/g/${slug}/join`);
  if (user) {
    // Ссылка или код уже и есть согласие вступить: бот по такой же ссылке
    // добавляет в группу сразу. Второй кнопки «Присоединиться» после входа нет.
    const already = await repo.isMember(chat.chatId, user.userId);
    if (!already) await repo.addMembership(chat.chatId, user.userId);
    redirect(already ? `/g/${slug}` : await afterJoinPath(slug, user));
  }

  const t = translator(chat.lang);
  const members = await repo.chatMembers(chat.chatId);

  return (
    <>
      <Topbar lang={chat.lang} />
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
