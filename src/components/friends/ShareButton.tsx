"use client";

import { webApp } from "@/lib/telegram";
import { toast } from "../toast";

/** Окно «поделиться» Telegram с готовой ссылкой и текстом. */
function telegramShareUrl(url: string, text: string): string {
  return `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
}

/**
 * «Поделиться» ссылкой или текстом.
 *
 * via="system": внутри Telegram — его окно «поделиться» (выбрать чат), на
 * телефоне — системное меню (Web Share), иначе ссылка копируется.
 * via="telegram": всегда окно «поделиться» Telegram — например, отправить
 * другу общие свободные окна прямо в личку. `telegramUrl` — своя ссылка для
 * Telegram (открывает мини-апп сразу), если есть.
 */
export function ShareButton({
  url,
  telegramUrl,
  text,
  title,
  label,
  copied,
  via = "system",
  className = "btn btn-sm",
  children,
}: {
  url: string;
  telegramUrl?: string | null;
  text: string;
  title?: string;
  label: string;
  copied: string;
  via?: "system" | "telegram";
  className?: string;
  children?: React.ReactNode;
}) {
  async function share() {
    const app = webApp();
    if (app?.openTelegramLink) {
      app.openTelegramLink(telegramShareUrl(telegramUrl ?? url, text));
      return;
    }
    if (via === "telegram") {
      window.open(telegramShareUrl(url, text), "_blank", "noopener,noreferrer");
      return;
    }
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch (error) {
        // Человек закрыл меню — ничего не делаем; другая ошибка — копируем ссылку.
        if ((error as DOMException).name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast(copied);
    } catch {
      window.prompt(copied, url);
    }
  }

  return (
    <button type="button" className={className} onClick={() => void share()}>
      {children}
      {label}
    </button>
  );
}
