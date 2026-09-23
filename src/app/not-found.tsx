import Link from "next/link";

import { BrandBar } from "@/components/BrandBar";
import { t } from "@/i18n";

/**
 * «Не найдено». Шапка — без данных (BrandBar), а не Topbar: этот элемент Next
 * отрисовывает на сервере при каждом запросе любой страницы — как запасной на
 * случай notFound(), — и Topbar добавлял бы к каждой странице дюжину запросов
 * в базу за профилем и группами.
 */
export default function NotFound() {
  return (
    <>
      <BrandBar />
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
