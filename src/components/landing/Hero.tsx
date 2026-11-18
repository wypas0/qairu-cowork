import Link from "next/link";

import { DEMO_PEOPLE } from "@/core/landingDemo";
import { tn, translator, weekdayShort } from "@/i18n";
import { HeroDemo, type HeroDemoLabels } from "./HeroDemo";
import { OpenGroupsButton } from "./OpenGroupsButton";

/**
 * Заголовок с одним акцентным словом рукописным шрифтом.
 *
 * Перенос строк не должен зависеть от шрифта акцентного слова (Р15): Caveat
 * включается после загрузки (DecoFonts) и уже своего запасного варианта, и
 * заголовок переносился иначе — всё ниже прыгало на строку. Поэтому хвост
 * заголовка с акцентом — неразрывный блок, ширину которому задаёт невидимая
 * копия в запасном шрифте (он есть с первой отрисовки и не меняется), а
 * видимая копия лежит поверх. Акцент во всех трёх языках стоит в конце
 * заголовка, так что разница ширины уходит в пустоту после него.
 */
function withAccent(title: string, accent: string) {
  const at = accent ? title.indexOf(accent) : -1;
  if (at < 0) return title;
  const tail = title.slice(at + accent.length);
  return (
    <>
      {title.slice(0, at)}
      <span className="accent-line">
        <span className="accent-size" aria-hidden="true">
          <i className="script-sizer">{accent}</i>
          {tail}
        </span>
        <span className="accent-ink">
          <i className="script-word">{accent}</i>
          {tail}
        </span>
      </span>
    </>
  );
}

/** Тексты витрины: формы с числом считаются здесь, словари в браузер не едут. */
function demoLabels(lang: string): HeroDemoLabels {
  const t = translator(lang);
  const total = DEMO_PEOPLE.length;
  return {
    days: [0, 1, 2, 3, 4].map((weekday) => weekdayShort(lang, weekday)),
    caption: t("w_l_demo_caption"),
    people: t("w_l_demo_people"),
    all: t("w_best_all"),
    freeOf: Array.from({ length: total + 1 }, (_, n) => tn(lang, "w_l_free_of", n, { total })),
    live: t("w_l_demo_live", { total, n: "{n}", day: "{day}", time: "{time}", free: "{free}" }),
    last: t("w_l_demo_last", { name: "{name}" }),
    hint: t("w_l_demo_hint"),
    legendAll: t("w_legend_all"),
    legendNone: t("w_legend_none"),
  };
}

/**
 * Л1. Витрина: заголовок, две кнопки и живая карта недели. Витрина тёмная в
 * обеих темах; небо — картинка на `.hero::before`, которая за указателем
 * чуть сдвигается (HeroDemo, landing.css).
 */
export function Hero({ lang, signedIn, createHref }: { lang: string; signedIn: boolean; createHref: string }) {
  const t = translator(lang);
  return (
    <>
      {/* Небо витрины — самый крупный элемент первого экрана (LCP). Фоновую
          картинку браузер находит только после разбора CSS; ссылка в разметке
          отдаёт её сразу и с высоким приоритетом. */}
      <link rel="preload" as="image" href="/hero-sky.jpg" fetchPriority="high" />
      <section className="hero sky-panel">
        <div className="hero-text">
          <h1 className="type-display">{withAccent(t("w_hero_title"), t("w_hero_accent"))}</h1>
          <p className="lead">{t("w_hero_lead")}</p>
          <div className="hero-actions">
            {signedIn ? (
              // Окно «Создать группу» открывает CreateGroupDialog по ссылке на #create.
              <a className="btn btn-primary" href={createHref}>
                {t("w_create")}
              </a>
            ) : (
              <Link className="btn btn-primary" href={createHref}>
                {t("w_create")}
              </Link>
            )}
            {signedIn ? (
              <OpenGroupsButton label={t("w_l_hero_code")} />
            ) : (
              <a className="btn" href="#join">
                {t("w_l_hero_code")}
              </a>
            )}
          </div>
        </div>
        {/* Сразу показываем сам продукт, а не рассказ о нём. */}
        <HeroDemo labels={demoLabels(lang)} />
      </section>
    </>
  );
}
