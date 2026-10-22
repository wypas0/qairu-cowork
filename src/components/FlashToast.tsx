"use client";

import { startTransition, useEffect, useRef } from "react";

import { toast } from "./toast";

/**
 * Итог серверного действия — «Сохранено», «Отправлено», ошибка — тостом.
 *
 * Серверное действие возвращает человека на страницу с параметром в адресе
 * (?saved=…, ?err=…). Раньше по нему наверху страницы рисовалась плашка,
 * далеко от кнопки, которую нажимали. Теперь это тост, а параметр сразу
 * убирается из адреса, чтобы обновление страницы не повторяло сообщение.
 *
 * `action` — кнопка в тосте (например, «Вернуть» после отказа): серверное
 * действие, которое вызывается по нажатию. `id` — чем один итог отличается
 * от другого с тем же текстом (два отказа подряд — два тоста).
 */
export function FlashToast({
  message,
  tone = "ok",
  params,
  action,
  id,
}: {
  message: string | null;
  tone?: "ok" | "error";
  params: string[];
  action?: { label: string; run: () => void | Promise<void> };
  id?: string;
}) {
  // Перерисовка страницы не должна показывать то же сообщение ещё раз.
  const shown = useRef<string | null>(null);
  const names = params.join(",");
  const label = action?.label;
  const run = action?.run;

  useEffect(() => {
    const key = message ? `${message}|${id ?? ""}` : null;
    if (!message || !key || shown.current === key) return;
    shown.current = key;
    toast(
      message,
      tone,
      label && run
        ? {
            label,
            run: () =>
              startTransition(() => {
                void run();
              }),
          }
        : undefined,
    );
    const url = new URL(window.location.href);
    let changed = false;
    for (const name of names.split(",")) {
      if (url.searchParams.has(name)) {
        url.searchParams.delete(name);
        changed = true;
      }
    }
    if (changed) window.history.replaceState(window.history.state, "", url);
  }, [message, tone, names, label, run, id]);

  return null;
}
