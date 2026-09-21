"use client";

import { useEffect, useRef } from "react";

import { toast } from "./toast";

/**
 * Итог серверного действия — «Сохранено», «Отправлено», ошибка — тостом.
 *
 * Серверное действие возвращает человека на страницу с параметром в адресе
 * (?saved=…, ?err=…). Раньше по нему наверху страницы рисовалась плашка,
 * далеко от кнопки, которую нажимали. Теперь это тост, а параметр сразу
 * убирается из адреса, чтобы обновление страницы не повторяло сообщение.
 */
export function FlashToast({
  message,
  tone = "ok",
  params,
}: {
  message: string | null;
  tone?: "ok" | "error";
  params: string[];
}) {
  // Перерисовка страницы не должна показывать то же сообщение ещё раз.
  const shown = useRef<string | null>(null);
  const names = params.join(",");

  useEffect(() => {
    if (!message || shown.current === message) return;
    shown.current = message;
    toast(message, tone);
    const url = new URL(window.location.href);
    let changed = false;
    for (const name of names.split(",")) {
      if (url.searchParams.has(name)) {
        url.searchParams.delete(name);
        changed = true;
      }
    }
    if (changed) window.history.replaceState(window.history.state, "", url);
  }, [message, tone, names]);

  return null;
}
