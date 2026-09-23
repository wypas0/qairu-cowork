/**
 * Строки страниц ошибки. Страница ошибки — клиентский компонент, и тянуть в
 * браузер все словари ради нескольких строк незачем, поэтому они здесь, отдельно.
 */
import type { Lang } from ".";

export type ErrorText = { title: string; lead: string; code: string; retry: string; home: string };

export const ERROR_TEXT: Record<Lang, ErrorText> = {
  ru: {
    title: "Что-то пошло не так",
    lead: "Страница не открылась из-за сбоя на сервере. Попробуй ещё раз — обычно это помогает.",
    code: "Код ошибки",
    retry: "Попробовать ещё раз",
    home: "На главную",
  },
  kk: {
    title: "Бірдеңе дұрыс болмады",
    lead: "Серверде ақау болғандықтан бет ашылмады. Тағы бір рет байқап көр — әдетте көмектеседі.",
    code: "Қате коды",
    retry: "Қайта байқау",
    home: "Басты бетке",
  },
  en: {
    title: "Something went wrong",
    lead: "The page didn't load because of a server error. Try again — it usually helps.",
    code: "Error code",
    retry: "Try again",
    home: "Home",
  },
};

/** Строки по коду языка вида `kk-KZ` — как normalizeLang, но без словарей. */
export function errorText(code: string | null | undefined): ErrorText {
  const short = (code ?? "").split("-")[0].toLowerCase();
  return short === "kk" || short === "en" ? ERROR_TEXT[short] : ERROR_TEXT.ru;
}
