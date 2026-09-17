import Link from "next/link";

import { BrandMark } from "@/components/icons";
import { translator } from "@/i18n";
import { currentUser } from "@/lib/auth";
import { ProfilePanel, type ProfilePanelProps } from "./ProfilePanel";
import { profilePanelProps } from "./profilePanelProps";

export async function Topbar({
  children,
  lang: langOverride,
  panel: ready,
}: {
  children?: React.ReactNode;
  lang?: string;
  /** Готовые данные панели профиля, если их уже собрал сайдбар. */
  panel?: ProfilePanelProps;
}) {
  const user = await currentUser();
  const lang = langOverride ?? user?.lang ?? "ru";
  const t = translator(lang);
  const panel = ready ?? (await profilePanelProps(lang));

  return (
    <header className="topbar">
      <ProfilePanel {...panel} />
      <Link className="brand" href="/">
        <BrandMark className="brand-mark" />
        <span>
          Qairu<b>Cowork</b>
        </span>
      </Link>
      <span className="spacer" />
      {children}
      {!user && (
        <Link className="btn btn-sm" href="/login">
          {t("w_login_btn")}
        </Link>
      )}
    </header>
  );
}
