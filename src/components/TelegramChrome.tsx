"use client";

import { useEffect } from "react";

import { THEME_COOKIE, normalizeTheme } from "@/lib/theme";
import { haptic, themeColor, whenReady } from "@/lib/telegram";

/**
 * Приводит мини-апп в порядок внутри Telegram: разворачивает окно, красит
 * шапку и фон в цвета нашей темы, следует за светлой/тёмной темой клиента и
 * отдаёт отступы безопасной зоны в CSS.
 *
 * Палитру Telegram мы не берём — у продукта своя (DESIGN.md). Берём ровно две
 * вещи: какая тема сейчас у человека (светлая или тёмная) и возможность
 * покрасить шапку, чтобы страница не вспыхивала чужим фоном поверх чата.
 *
 * Атрибут data-tg на <html> позволяет скрыть из вёрстки то, что в Telegram
 * делают нативные кнопки (класс .tg-hide).
 */
export function TelegramChrome() {
  useEffect(() => {
    return whenReady((app) => {
      const root = document.documentElement;
      root.dataset.tg = "1";
      app.ready();
      app.expand();
      // Иначе протяжка пальцем по сетке расписания сворачивает мини-апп.
      app.disableVerticalSwipes?.();

      /** Тема сайта из куки: «system» означает «как у Telegram». */
      function siteTheme() {
        const raw = document.cookie
          .split("; ")
          .find((part) => part.startsWith(`${THEME_COOKIE}=`))
          ?.slice(THEME_COOKIE.length + 1);
        return normalizeTheme(raw ? decodeURIComponent(raw) : undefined);
      }

      function syncTheme() {
        const wanted = siteTheme() === "system" ? app.colorScheme : null;
        // Сравниваем перед записью: иначе наблюдатель ниже вызовет сам себя.
        if (wanted && root.dataset.theme !== wanted) root.dataset.theme = wanted;
      }

      function paintColors() {
        // Цвета читаем после смены data-theme — это токены текущей темы.
        const header = themeColor("--surface");
        const background = themeColor("--bg");
        try {
          if (header) app.setHeaderColor?.(header);
          if (background) {
            app.setBackgroundColor?.(background);
            app.setBottomBarColor?.(background);
          }
        } catch {
          // Клиенты до Bot API 6.9 не принимают произвольный цвет — тогда
          // остаётся их собственный фон шапки, остальное работает.
        }
      }

      function paint() {
        syncTheme();
        paintColors();
      }

      function insets() {
        const safe = app.safeAreaInset;
        const content = app.contentSafeAreaInset;
        if (!safe && !content) return;
        const top = (safe?.top ?? 0) + (content?.top ?? 0);
        const bottom = (safe?.bottom ?? 0) + (content?.bottom ?? 0);
        root.style.setProperty("--safe-top", `${top}px`);
        root.style.setProperty("--safe-bottom", `${bottom}px`);
        root.style.setProperty("--safe-left", `${safe?.left ?? 0}px`);
        root.style.setProperty("--safe-right", `${safe?.right ?? 0}px`);
      }

      // Лёгкий отклик на нажатие — как в нативных экранах Telegram.
      // Точечные отклики (покраска клетки, сохранение) живут в своих компонентах.
      function onPress(event: PointerEvent) {
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (target.closest("button, .btn, a.btn")) haptic("press");
      }
      document.addEventListener("pointerdown", onPress, { passive: true });

      paint();
      insets();
      // Тему можно сменить руками в панели профиля — шапка должна догнать.
      const watchTheme = new MutationObserver(paintColors);
      watchTheme.observe(root, { attributeFilter: ["data-theme"] });
      app.onEvent?.("themeChanged", paint);
      app.onEvent?.("safeAreaChanged", insets);
      app.onEvent?.("contentSafeAreaChanged", insets);

      return () => {
        watchTheme.disconnect();
        document.removeEventListener("pointerdown", onPress);
        app.offEvent?.("themeChanged", paint);
        app.offEvent?.("safeAreaChanged", insets);
        app.offEvent?.("contentSafeAreaChanged", insets);
      };
    });
  }, []);

  return null;
}
