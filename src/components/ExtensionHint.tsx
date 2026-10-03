"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { EXT_SOURCE, LATEST_EXTENSION, PAGE_SOURCE, olderVersion } from "@/core/extensionImport";
import { webApp } from "@/lib/telegram";

const DISMISSED_KEY = "qairu-ext-hint-dismissed";

type UAData = { mobile?: boolean; brands?: { brand: string }[] };

/** Компьютер с браузером на Chromium — там ставятся расширения Chrome. */
function desktopChromium(): boolean {
  const data = (navigator as Navigator & { userAgentData?: UAData }).userAgentData;
  return !!data && data.mobile === false && !!data.brands?.some((item) => /Chromium|Google Chrome/.test(item.brand));
}

/**
 * Подсказка про расширение кампуса над «Моим расписанием»: «поставь», если его
 * нет, и «обнови», если версия старая. Расширение отвечает на ping сообщением
 * campus-present; заодно узнаёт язык сайта. В Telegram и на телефоне молчим —
 * там расширений не бывает.
 */
export function ExtensionHint({
  lang,
  labels,
}: {
  lang: string;
  labels: { install: string; update: string; how: string; later: string };
}) {
  const [state, setState] = useState<"hidden" | "install" | "update">("hidden");

  useEffect(() => {
    let version: string | null = null;
    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data as { source?: unknown; type?: unknown; version?: unknown } | null;
      if (data?.source !== EXT_SOURCE || data.type !== "campus-present") return;
      // Расширение могло загрузиться позже нашего ping и ответить само — язык сообщаем отдельно.
      if (!version) window.postMessage({ source: PAGE_SOURCE, type: "campus-lang", lang }, window.location.origin);
      version = typeof data.version === "string" ? data.version : "0.0.0";
    }
    window.addEventListener("message", onMessage);
    window.postMessage({ source: PAGE_SOURCE, type: "campus-ping", lang }, window.location.origin);

    // Ждём ответа расширения и скрипта Telegram (он грузится до трёх секунд).
    const timer = setTimeout(() => {
      if (webApp() || !desktopChromium()) return;
      if (version) {
        if (olderVersion(version, LATEST_EXTENSION)) setState("update");
        return;
      }
      try {
        if (localStorage.getItem(DISMISSED_KEY) === "1") return;
      } catch {
        // Без хранилища просто покажем.
      }
      setState("install");
    }, 3000);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
    };
  }, [lang]);

  if (state === "hidden") return null;

  function dismiss() {
    setState("hidden");
    if (state !== "install") return;
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Не запомнили — покажем в следующий раз, это не страшно.
    }
  }

  return (
    <div className="notice notice-row ext-hint" role="status">
      <span>{state === "update" ? labels.update : labels.install}</span>
      <span className="notice-actions">
        <Link className="btn btn-sm" href="/extension">
          {labels.how}
        </Link>
        <button type="button" className="btn btn-sm btn-quiet" onClick={dismiss}>
          {labels.later}
        </button>
      </span>
    </div>
  );
}
