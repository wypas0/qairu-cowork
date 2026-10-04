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
  labels: { install: string; update: string; how: string; later: string; changed: string; pull: string };
}) {
  const [state, setState] = useState<"hidden" | "install" | "update">("hidden");
  // Фоновая сверка расширения нашла изменения в кампусе — предлагаем подставить.
  const [change, setChange] = useState<{ added: number; removed: number } | null>(null);

  useEffect(() => {
    let version: string | null = null;
    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data as { source?: unknown; type?: unknown; version?: unknown; change?: unknown } | null;
      if (data?.source !== EXT_SOURCE) return;
      // Пары пришли (по «Подставить» или из окна расширения) — сообщение больше не нужно.
      if (data.type === "campus-slots") setChange(null);
      if (data.type !== "campus-present") return;
      const found = data.change as { added?: unknown; removed?: unknown } | null | undefined;
      const added = Number(found?.added);
      const removed = Number(found?.removed);
      setChange(
        found && Number.isInteger(added) && Number.isInteger(removed) && added + removed > 0 && added >= 0 && removed >= 0
          ? { added, removed }
          : null,
      );
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

  const changeNotice = change && (
    <div className="notice notice-row ext-hint" role="status">
      <span>{labels.changed.replace("{added}", String(change.added)).replace("{removed}", String(change.removed))}</span>
      <span className="notice-actions">
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => window.postMessage({ source: PAGE_SOURCE, type: "campus-pull" }, window.location.origin)}
        >
          {labels.pull}
        </button>
      </span>
    </div>
  );

  if (state === "hidden") return changeNotice || null;

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
    <>
    {changeNotice}
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
    </>
  );
}
