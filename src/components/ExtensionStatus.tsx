"use client";

import { useSyncExternalStore } from "react";

import { LATEST_EXTENSION, olderVersion } from "@/core/extensionImport";

import { IconAlert, IconCheck } from "./icons";
import { desktopChromium, useCampusExtension } from "./useCampusExtension";

const noop = () => () => {};

/**
 * Живая проверка на странице /extension: стоит ли расширение в этом браузере и
 * какой версии. Спрашивает его тем же campus-ping, что и «Моё расписание».
 */
export function ExtensionStatus({
  lang,
  labels,
}: {
  lang: string;
  labels: { checking: string; ok: string; old: string; none: string; unsupported: string };
}) {
  const extension = useCampusExtension(lang, 1500);
  // Телефон или браузер не на Chromium узнаём только в браузере; на сервере — «проверяю».
  const supported = useSyncExternalStore(noop, desktopChromium, () => true);

  let tone = "";
  let text = labels.checking;
  let icon: React.ReactNode = null;
  if (extension.status === "present") {
    const version = extension.version ?? "0.0.0";
    if (olderVersion(version, LATEST_EXTENSION)) {
      tone = "stale";
      text = labels.old.replace("{v}", version).replace("{latest}", LATEST_EXTENSION);
      icon = <IconAlert size={14} />;
    } else {
      tone = "ok";
      text = labels.ok.replace("{v}", version);
      icon = <IconCheck size={14} />;
    }
  } else if (extension.status === "absent") {
    text = supported ? labels.none : labels.unsupported;
  }

  return (
    <p className={`badge ext-status${tone ? ` ${tone}` : ""}`} role="status" aria-live="polite" data-state={extension.status}>
      {icon}
      <span>{text}</span>
    </p>
  );
}
