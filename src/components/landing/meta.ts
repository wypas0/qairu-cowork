import type { Metadata } from "next";

import { type Lang, normalizeLang, translator } from "@/i18n";

/** og:locale по языку страницы. */
const OG_LOCALE: Record<Lang, string> = { ru: "ru_RU", kk: "kk_KZ", en: "en_US" };

/**
 * Заголовок, описание и превью лендинга на языке посетителя (Р18).
 *
 * openGraph страницы заменяет openGraph из layout целиком (метаданные
 * сливаются неглубоко), поэтому тип и имя сайта повторены здесь. Картинку
 * превью по-прежнему даёт файл app/opengraph-image.tsx.
 */
export function landingMetadata(lang: string): Metadata {
  const code = normalizeLang(lang);
  const t = translator(code);
  const title = t("w_l_meta_title");
  const description = t("w_l_meta_desc");
  return {
    title,
    description,
    openGraph: {
      type: "website",
      siteName: "QairuCowork",
      title,
      description,
      locale: OG_LOCALE[code],
    },
  };
}
