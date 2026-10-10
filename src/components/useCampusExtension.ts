"use client";

import { useCallback, useEffect, useState } from "react";

import { EXT_SOURCE, PAGE_SOURCE } from "@/core/extensionImport";

type UAData = { mobile?: boolean; brands?: { brand: string }[] };

/** Компьютер с браузером на Chromium — там ставятся расширения Chrome. */
export function desktopChromium(): boolean {
  const data = (navigator as Navigator & { userAgentData?: UAData }).userAgentData;
  return !!data && data.mobile === false && !!data.brands?.some((item) => /Chromium|Google Chrome/.test(item.brand));
}

export type CampusExtension = {
  /** checking — ждём ответа; present — ответило; absent — за время ожидания молчит. */
  status: "checking" | "present" | "absent";
  version: string | null;
  /** Фоновая сверка расширения нашла изменения в кампусе. */
  change: { added: number; removed: number } | null;
};

/**
 * Есть ли расширение кампуса и какой версии. Сайт шлёт campus-ping, расширение
 * отвечает campus-present (и шлёт его само при загрузке — тогда сообщаем язык
 * отдельно). Принимаем сообщения только от этой же страницы.
 */
export function useCampusExtension(lang: string, waitMs = 3000): CampusExtension & { clearChange: () => void } {
  const [state, setState] = useState<CampusExtension>({ status: "checking", version: null, change: null });

  useEffect(() => {
    let answered = false;
    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data as { source?: unknown; type?: unknown; version?: unknown; change?: unknown } | null;
      if (data?.source !== EXT_SOURCE) return;
      // Пары пришли (по «Подставить» или из окна расширения) — сообщение об изменениях больше не нужно.
      if (data.type === "campus-slots") setState((current) => ({ ...current, change: null }));
      if (data.type !== "campus-present") return;
      const found = data.change as { added?: unknown; removed?: unknown } | null | undefined;
      const added = Number(found?.added);
      const removed = Number(found?.removed);
      const change =
        found && Number.isInteger(added) && Number.isInteger(removed) && added + removed > 0 && added >= 0 && removed >= 0
          ? { added, removed }
          : null;
      // Расширение могло загрузиться позже нашего ping и ответить само — язык сообщаем отдельно.
      if (!answered) window.postMessage({ source: PAGE_SOURCE, type: "campus-lang", lang }, window.location.origin);
      answered = true;
      const version =
        typeof data.version === "string" && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(data.version) ? data.version : "0.0.0";
      setState({ status: "present", version, change });
    }
    window.addEventListener("message", onMessage);
    window.postMessage({ source: PAGE_SOURCE, type: "campus-ping", lang }, window.location.origin);
    const timer = setTimeout(() => {
      if (!answered) setState((current) => ({ ...current, status: "absent" }));
    }, waitMs);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
    };
  }, [lang, waitMs]);

  const clearChange = useCallback(() => setState((current) => ({ ...current, change: null })), []);
  return { ...state, clearChange };
}
