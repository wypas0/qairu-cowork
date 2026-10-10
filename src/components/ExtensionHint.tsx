"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { EXT_SOURCE, LATEST_EXTENSION, PAGE_SOURCE, campusScheduleUrl, olderVersion, supportsIntent } from "@/core/extensionImport";
import { webApp } from "@/lib/telegram";

import { desktopChromium, useCampusExtension } from "./useCampusExtension";

const DISMISSED_KEY = "qairu-ext-hint-dismissed";

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false; // без хранилища просто покажем
  }
}

/**
 * Подсказка про расширение кампуса над «Моим расписанием»: «поставь», если его
 * нет, «обнови», если версия старая, и «Перенести из кампуса», если оно стоит.
 * По кнопке сайт сообщает расширению группу и открывает кампус; там расширение
 * само предлагает перенос и возвращает сюда пары на проверку. В Telegram и на
 * телефоне про установку молчим — там расширений не бывает.
 */
export function ExtensionHint({
  lang,
  title,
  labels,
}: {
  lang: string;
  /** Название группы — для карточки расширения на кампусе. */
  title: string;
  labels: {
    install: string;
    update: string;
    how: string;
    later: string;
    changed: string;
    pull: string;
    transferLead: string;
    transfer: string;
    transferSent: string;
  };
}) {
  const extension = useCampusExtension(lang);
  const [hidden, setHidden] = useState<{ install: boolean; update: boolean }>({ install: false, update: false });
  const [sent, setSent] = useState(false);

  // Пары вернулись из кампуса — «кампус открылся…» больше не нужно.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data as { source?: unknown; type?: unknown } | null;
      if (data?.source === EXT_SOURCE && data.type === "campus-slots") setSent(false);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const outdated = extension.status === "present" && olderVersion(extension.version ?? "0.0.0", LATEST_EXTENSION);
  const canTransfer = extension.status === "present" && supportsIntent(extension.version);
  const offerInstall =
    extension.status === "absent" && !hidden.install && !webApp() && desktopChromium() && !wasDismissed();

  function dismissInstall() {
    setHidden((current) => ({ ...current, install: true }));
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Не запомнили — покажем в следующий раз, это не страшно.
    }
  }

  function transfer() {
    // Кампус открывает сама ссылка (новая вкладка — без блокировки окон),
    // расширение запоминает группу; карточка на кампусе дождётся записи.
    window.postMessage({ source: PAGE_SOURCE, type: "campus-intent", title, lang }, window.location.origin);
    setSent(true);
  }

  return (
    <>
      {extension.change && (
        <div className="notice notice-row ext-hint" role="status">
          <span>
            {labels.changed
              .replace("{added}", String(extension.change.added))
              .replace("{removed}", String(extension.change.removed))}
          </span>
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
      )}

      {outdated && !hidden.update && (
        <div className="notice notice-row ext-hint" role="status">
          <span>{labels.update}</span>
          <span className="notice-actions">
            <Link className="btn btn-sm" href="/extension#update">
              {labels.how}
            </Link>
            <button
              type="button"
              className="btn btn-sm btn-quiet"
              onClick={() => setHidden((current) => ({ ...current, update: true }))}
            >
              {labels.later}
            </button>
          </span>
        </div>
      )}

      {canTransfer && (
        <div className="notice notice-row ext-hint ext-transfer" role="status">
          <span>{sent ? labels.transferSent : labels.transferLead}</span>
          <span className="notice-actions">
            <a
              className="btn btn-sm"
              href={campusScheduleUrl(lang)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={transfer}
              data-campus-transfer=""
            >
              {labels.transfer}
            </a>
          </span>
        </div>
      )}

      {offerInstall && (
        <div className="notice notice-row ext-hint" role="status">
          <span>{labels.install}</span>
          <span className="notice-actions">
            <Link className="btn btn-sm" href="/extension">
              {labels.how}
            </Link>
            <button type="button" className="btn btn-sm btn-quiet" onClick={dismissInstall}>
              {labels.later}
            </button>
          </span>
        </div>
      )}
    </>
  );
}
