"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

type WebApp = {
  initData?: string;
  ready: () => void;
  expand: () => void;
};

declare global {
  interface Window {
    Telegram?: { WebApp?: WebApp };
  }
}

/**
 * Вход из Telegram Mini App.
 *
 * `initData` подписан Telegram, поэтому сервер может доказать, что посетитель —
 * тот же человек, что и в боте, ничего у него не спрашивая. Обмен делается один
 * раз за загрузку страницы; если посетитель уже опознан по куке, перезагрузка
 * не нужна.
 */
export function TelegramAuth({ slug, authed }: { slug: string; authed: boolean }) {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    // Скрипт Telegram грузится с async, поэтому ждём его появления.
    function start(attempt = 0) {
      const app = window.Telegram?.WebApp;
      if (!app) {
        if (attempt < 20) setTimeout(() => start(attempt + 1), 100);
        return;
      }
      app.ready();
      app.expand();
      if (!app.initData) return;
      if (sessionStorage.getItem("qairu-tg-authed") === "1" && authed) return;

      void fetch("/api/tg-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ initData: app.initData, slug }),
      })
        .then((response) => {
          if (!response.ok || cancelled) return;
          sessionStorage.setItem("qairu-tg-authed", "1");
          if (!authed) router.refresh();
        })
        .catch(() => {
          // Обычный вход по ссылке-приглашению остаётся доступен.
        });
    }

    start();
    return () => {
      cancelled = true;
    };
  }, [slug, authed, router]);

  return null;
}
