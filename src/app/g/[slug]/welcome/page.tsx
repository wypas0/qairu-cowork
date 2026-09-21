import { notFound, redirect } from "next/navigation";

import { Topbar } from "@/components/Topbar";
import * as repo from "@/db/repo";
import { translator } from "@/i18n";
import { afterNamePath } from "@/lib/afterJoin";
import { pageUser } from "@/lib/gate";
import { saveGroupNameAction } from "../actions";

export const dynamic = "force-dynamic";

/**
 * Один вопрос сразу после вступления: как подписать человека в группе.
 *
 * Имя из Telegram часто ник или имя без фамилии, и староста не понимает, кто
 * это. Спрашиваем один раз — ответ общий для всех групп, как и расписание.
 */
export default async function WelcomePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const chat = await repo.getChatBySlug(slug);
  if (!chat) notFound();

  const user = await pageUser(`/g/${slug}/welcome`);
  if (!user || !(await repo.isMember(chat.chatId, user.userId))) redirect(`/g/${slug}/join`);
  if (user.realName) redirect(await afterNamePath(slug, user.userId));

  const t = translator(chat.lang);

  return (
    <>
      <Topbar lang={chat.lang} />
      <main className="wrap">
        <div className="card" style={{ maxWidth: 520, margin: "32px auto" }}>
          <p className="eyebrow">{chat.title}</p>
          <h1 className="type-title-2" style={{ marginTop: 4 }}>
            {t("w_welcome_title")}
          </h1>
          <p className="small muted">{t("w_welcome_lead")}</p>
          <form action={saveGroupNameAction.bind(null, slug)}>
            <div className="field">
              <label htmlFor="real_name">{t("w_welcome_name")}</label>
              <input
                id="real_name"
                name="real_name"
                type="text"
                defaultValue={user.fullName ?? ""}
                maxLength={repo.REAL_NAME_MAX}
                autoComplete="name"
                autoFocus
              />
            </div>
            <button className="btn btn-primary btn-lg" type="submit">
              {t("w_welcome_btn")}
            </button>
          </form>
          <p className="small muted" style={{ marginTop: 12, marginBottom: 0 }}>
            {t("w_welcome_note")}
          </p>
        </div>
      </main>
    </>
  );
}
