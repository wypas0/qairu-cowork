"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { themeColor, whenReady } from "@/lib/telegram";

/**
 * Главная кнопка Telegram внизу экрана. Вне Telegram ничего не рисует —
 * страница показывает свою кнопку с классом `tg-hide`, которая внутри
 * мини-аппа скрыта.
 */
export function TelegramMainButton({
  text,
  onClick,
  disabled = false,
  progress = false,
}: {
  text: string;
  onClick: () => void;
  disabled?: boolean;
  progress?: boolean;
}) {
  // Обработчик держим в ref: сама подписка ставится один раз, иначе при каждой
  // перерисовке пришлось бы снимать и заново вешать нативный клик.
  const handler = useRef(onClick);
  useEffect(() => {
    handler.current = onClick;
  }, [onClick]);

  useEffect(
    () =>
      whenReady((app) => {
        const button = app.MainButton;
        if (!button) return;
        const fire = () => handler.current();
        button.onClick(fire);
        return () => {
          button.offClick(fire);
          button.hide();
        };
      }),
    [],
  );

  useEffect(
    () =>
      whenReady((app) => {
        const button = app.MainButton;
        if (!button) return;
        const paint = () =>
          button.setParams({
            text,
            // Главное действие — как кнопка сайта: белая в тёмной теме, ink в
            // светлой. Раньше — синий с белым: в тёмной теме 4,27:1, ниже AA.
            color: themeColor("--ink") ?? undefined,
            text_color: themeColor("--ink-text") ?? "#ffffff",
            is_active: !disabled,
            is_visible: true,
          });
        paint();
        if (progress) button.showProgress(true);
        else button.hideProgress();
        // Тему меняют в панели профиля или в самом Telegram — цвет догоняет.
        const watchTheme = new MutationObserver(paint);
        watchTheme.observe(document.documentElement, { attributeFilter: ["data-theme"] });
        return () => watchTheme.disconnect();
      }),
    [text, disabled, progress],
  );

  return null;
}

/**
 * Кнопка «назад» в шапке Telegram. Ведёт туда же, куда ссылка на странице,
 * чтобы у человека не было двух разных «назад».
 */
export function TelegramBackButton({ href }: { href: string }) {
  const router = useRouter();

  useEffect(
    () =>
      whenReady((app) => {
        const button = app.BackButton;
        if (!button) return;
        const go = () => router.push(href);
        button.onClick(go);
        button.show();
        return () => {
          button.offClick(go);
          button.hide();
        };
      }),
    [href, router],
  );

  return null;
}
