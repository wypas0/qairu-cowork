"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

import { whenReady } from "@/lib/telegram";

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

    return whenReady((app) => {
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

      return () => {
        cancelled = true;
      };
    });
  }, [pathname, router]);

  return null;
}
