"use client";

import { useSyncExternalStore } from "react";

import { ErrorCard } from "@/components/ErrorCard";
import { errorText } from "@/i18n/errorText";

const subscribeNothing = () => () => {};

/**
 * Сбой при отрисовке страницы. Без этого файла Next показывал голое
 * «Application error» по-английски, и было непонятно, что делать дальше.
 * `retry` заново запрашивает страницу с сервера — временный сбой базы так
 * проходит без перезагрузки.
 */
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  // Язык уже стоит в <html lang> корневого layout; на сервере — русский.
  const lang = useSyncExternalStore(subscribeNothing, () => document.documentElement.lang, () => "ru");
  return <ErrorCard text={errorText(lang)} digest={error.digest} retry={retry} />;
}
