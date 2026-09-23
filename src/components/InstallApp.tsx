"use client";

import { useEffect, useState } from "react";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/**
 * «Установить приложение» вне Telegram. Кнопка появляется, только когда
 * браузер готов установить сайт (событие beforeinstallprompt), — в Safari и
 * внутри Telegram её нет. Заодно регистрирует service worker.
 */
export function InstallApp({ label }: { label: string }) {
  const [install, setInstall] = useState<InstallEvent | null>(null);

  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    function onPrompt(event: Event) {
      event.preventDefault();
      setInstall(event as InstallEvent);
    }
    const onInstalled = () => setInstall(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!install) return null;
  return (
    <button
      type="button"
      className="btn btn-sm install-app"
      onClick={async () => {
        await install.prompt();
        await install.userChoice.catch(() => null);
        setInstall(null);
      }}
    >
      {label}
    </button>
  );
}
