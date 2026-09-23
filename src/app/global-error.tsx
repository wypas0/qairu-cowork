"use client";

import { useSyncExternalStore } from "react";

import { ErrorCard } from "@/components/ErrorCard";
import { errorText } from "@/i18n/errorText";

import "./globals.css";

const subscribeNothing = () => () => {};

/**
 * Сбой в самом корневом layout — страница рисуется целиком заново, со своими
 * <html> и <body>. Языка из layout здесь нет, поэтому берём язык браузера.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const lang = useSyncExternalStore(subscribeNothing, () => navigator.language, () => "ru");
  const text = errorText(lang);
  return (
    <html lang={lang.split("-")[0]}>
      <body>
        <title>{text.title}</title>
        <ErrorCard text={text} digest={error.digest} retry={retry} />
      </body>
    </html>
  );
}
