"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

type WebApp = {
  initData?: string;
  initDataUnsafe?: { start_param?: string };
  ready: () => void;
  expand: () => void;
};

declare global {
  interface Window {
    Telegram?: { WebApp?: WebApp };
  }
}

const DONE_KEY = "qairu-tg-authed";

/**
 * Вход из Telegram Mini App — на любой странице сайта.
 *
 * `initData` подписан Telegram, поэтому сервер может доказать, что посетитель —
 * тот же человек, что и в боте, ничего у него не спрашивая. Обмен делается один
 * раз за сессию вкладки; страница перерисовывается, только если сервер сообщил,
 * что вход или состав групп изменились. Ссылка-приглашение `/g/<slug>`
 * заодно добавляет человека в группу.
 */
export function TelegramAuth() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // Скрипт Telegram грузится с async, поэтому ждём его появления.
    function start(attempt = 0) {
      const app = window.Telegram?.WebApp;
      if (!app) {
        if (attempt < 30) timer = setTimeout(() => start(attempt + 1), 100);
        return;
      }
      if (!app.initData) return;
      app.ready();
      app.expand();

      const slug = /^\/g\/([a-z0-9]{3,24})(?:\/|$)/i.exec(pathname)?.[1] ?? app.initDataUnsafe?.start_param ?? "";
      const doneKey = `${DONE_KEY}:${slug}`;
      try {
        if (sessionStorage.getItem(doneKey) === "1") return;
      } catch {
        // Хранилище может быть недоступно — тогда просто повторим обмен.
      }

      void fetch("/api/tg-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ initData: app.initData, slug }),
      })
        .then(async (response) => {
          if (!response.ok || cancelled) return;
          const data = (await response.json().catch(() => ({}))) as { changed?: boolean };
          try {
            sessionStorage.setItem(doneKey, "1");
          } catch {
            // см. выше
          }
          if (data.changed) router.refresh();
        })
        .catch(() => {
          // Остаётся обычный вход через бота.
        });
    }

    start();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [pathname, router]);

  return null;
}
