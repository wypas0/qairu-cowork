import Link from "next/link";

import { Topbar } from "@/components/Topbar";
import { t } from "@/i18n";

export default function NotFound() {
  return (
    <>
      <Topbar />
      <main className="wrap">
        <div className="card" style={{ maxWidth: 520, margin: "32px auto" }}>
          <h1 style={{ fontSize: 22 }}>{t("ru", "w_not_found")}</h1>
          <p className="muted">{t("ru", "w_not_found_lead")}</p>
          <Link className="btn btn-primary" href="/">
            {t("ru", "w_home")}
          </Link>
        </div>
      </main>
    </>
  );
}
