import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { QrCode } from "@/components/QrCode";
import * as repo from "@/db/repo";
import { translator } from "@/i18n";
import { pageUser } from "@/lib/gate";
import { formatCode } from "@/lib/invite";
import { baseUrl } from "@/lib/url";

export const dynamic = "force-dynamic";

/**
 * Приглашение на весь экран — для проектора в аудитории: крупный QR, код
 * группы и ссылка. Только для участников: код — это вход в группу.
 */
export default async function InviteQrPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const chat = await repo.getChatBySlug(slug);
  if (!chat) notFound();
  const user = await pageUser(`/g/${slug}/qr`);
  if (!user || !(await repo.isMember(chat.chatId, user.userId))) redirect(`/g/${slug}/join`);

  const t = translator(chat.lang);
  const inviteUrl = `${await baseUrl()}/g/${slug}`;

  return (
    <main className="qr-page">
      <p className="eyebrow">{t("w_qr_title")}</p>
      <h1>{chat.title}</h1>
      <QrCode className="qr-large" value={inviteUrl} label={t("w_qr_label", { title: chat.title })} />
      <p className="qr-code-line">
        {t("w_code_title")}: <b className="code">{formatCode(slug)}</b>
      </p>
      <p className="small muted qr-url">{inviteUrl}</p>
      <Link className="btn btn-sm btn-quiet" href={`/g/${slug}?at=members`}>
        {t("w_pp_back")}
      </Link>
    </main>
  );
}
