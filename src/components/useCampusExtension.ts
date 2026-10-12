"use client";

import { useCallback, useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";

import {
  CAMPUS_TARGET,
  EXT_SOURCE,
  OPEN_ACK_MS,
  OPEN_SLOW_ACK_MS,
  PAGE_SOURCE,
  campusScheduleUrl,
  supportsOpenTab,
} from "@/core/extensionImport";

/** Как часто и сколько повторять campus-ping, пока расширение не нашлось. */
const REPING_MS = 3000;
const REPING_FOR_MS = 2 * 60 * 1000;

type UAData = { mobile?: boolean; brands?: { brand: string }[] };

/** Компьютер с браузером на Chromium — там ставятся расширения Chrome. */
export function desktopChromium(): boolean {
  const data = (navigator as Navigator & { userAgentData?: UAData }).userAgentData;
  return !!data && data.mobile === false && !!data.brands?.some((item) => /Chromium|Google Chrome/.test(item.brand));
}

export type CampusExtension = {
  /** checking — ждём ответа; present — ответило; absent — за время ожидания молчит. */
  status: "checking" | "present" | "absent";
  version: string | null;
  /** Фоновая сверка расширения нашла изменения в кампусе. */
  change: { added: number; removed: number } | null;
};

/**
 * Есть ли расширение кампуса и какой версии. Сайт шлёт campus-ping, расширение
 * отвечает campus-present (и шлёт его само при загрузке — тогда сообщаем язык
 * отдельно). Принимаем сообщения только от этой же страницы.
 *
 * Статус не залипает на «нет»: расширение, поставленное при открытой странице,
 * само пришлёт campus-present (0.4.1 внедряется в уже открытые вкладки), а на
 * случай, когда не пришлёт, пока статус absent и вкладка на виду, ping уходит
 * снова — при возвращении на вкладку и раз в REPING_MS в течение REPING_FOR_MS.
 */
export function useCampusExtension(lang: string, waitMs = 3000): CampusExtension & { clearChange: () => void } {
  const [state, setState] = useState<CampusExtension>({ status: "checking", version: null, change: null });

  useEffect(() => {
    let answered = false;
    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data as { source?: unknown; type?: unknown; version?: unknown; change?: unknown } | null;
      if (data?.source !== EXT_SOURCE) return;
      // Пары пришли (по «Подставить» или из окна расширения) — сообщение об изменениях больше не нужно.
      if (data.type === "campus-slots") setState((current) => ({ ...current, change: null }));
      if (data.type !== "campus-present") return;
      const found = data.change as { added?: unknown; removed?: unknown } | null | undefined;
      const added = Number(found?.added);
      const removed = Number(found?.removed);
      const change =
        found && Number.isInteger(added) && Number.isInteger(removed) && added + removed > 0 && added >= 0 && removed >= 0
          ? { added, removed }
          : null;
      // Расширение могло загрузиться позже нашего ping и ответить само — язык сообщаем отдельно.
      if (!answered) window.postMessage({ source: PAGE_SOURCE, type: "campus-lang", lang }, window.location.origin);
      answered = true;
      const version =
        typeof data.version === "string" && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(data.version) ? data.version : "0.0.0";
      setState({ status: "present", version, change });
    }
    window.addEventListener("message", onMessage);
    window.postMessage({ source: PAGE_SOURCE, type: "campus-ping", lang }, window.location.origin);
    const timer = setTimeout(() => {
      if (!answered) setState((current) => ({ ...current, status: "absent" }));
    }, waitMs);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
    };
  }, [lang, waitMs]);

  // Пока расширения нет — спрашиваем ещё: вдруг его только что поставили.
  const absent = state.status === "absent";
  useEffect(() => {
    if (!absent) return;
    let until = Date.now() + REPING_FOR_MS;
    const ping = () => window.postMessage({ source: PAGE_SOURCE, type: "campus-ping", lang }, window.location.origin);
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible" || Date.now() > until) return;
      ping();
    }, REPING_MS);
    // Вернулись на вкладку (из chrome://extensions, например) — спрашиваем сразу и ещё две минуты.
    const wake = () => {
      if (document.visibilityState !== "visible") return;
      until = Date.now() + REPING_FOR_MS;
      ping();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
    };
  }, [absent, lang]);

  const clearChange = useCallback(() => setState((current) => ({ ...current, change: null })), []);
  return { ...state, clearChange };
}

/** Когда в этой вкладке последний раз нажали «Перенести из кампуса» (мс), 0 — не нажимали. */
let lastTransferAt = 0;
/** Браузер не дал открыть кампус из скрипта — дальше ссылка работает как обычная. */
let openBlocked = false;
/** Событие окну: кампус открыть не удалось, подсказка «кампус открылся…» не нужна. */
export const CAMPUS_BLOCKED_EVENT = "qairu-campus-blocked";

/**
 * Запасной путь (расширение 0.4.0 или фон не ответил): открыть кампус в окне с
 * постоянным именем, чтобы повторные нажатия брали ту же вкладку. Без noopener:
 * окно с noopener (или с обнулённым window.opener) уходит в отдельную группу —
 * по имени его не найти и не перевести на другой адрес, каждый раз открылась бы
 * новая вкладка (проверено в Chromium). Цена — у кампуса есть window.opener:
 * прочитать сайт он не может (другой источник), только перевести эту вкладку.
 * Кампус — сайт университета, которому и так доверено расписание; основной путь
 * (0.4.1+, вкладку открывает расширение) opener не даёт вовсе. Сами ссылки
 * остаются с noopener noreferrer: по ним (Ctrl+клик, браузер не дал открыть
 * окно) кампус открывается как обычная внешняя ссылка.
 */
function openCampusWindow(url: string): boolean {
  const win = window.open(url, CAMPUS_TARGET);
  if (!win) return false;
  try {
    win.focus();
  } catch {
    // Фокус — удобство, не обязанность.
  }
  return true;
}

/**
 * Ждём ответ расширения на campus-intent с open: true; true — оно открыло кампус само.
 * «campus-intent-opening» (принял, открываю) продлевает ожидание до OPEN_SLOW_ACK_MS от
 * нажатия: иначе медленный фон и запасное окно открыли бы две вкладки кампуса.
 */
function waitForOpenAck(): Promise<boolean> {
  return new Promise((resolve) => {
    const started = Date.now();
    const finish = (opened: boolean) => {
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(opened);
    };
    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data as { source?: unknown; type?: unknown; opened?: unknown } | null;
      if (data?.source !== EXT_SOURCE) return;
      if (data.type === "campus-intent-ok") finish(data.opened === true);
      if (data.type === "campus-intent-opening") {
        clearTimeout(timer);
        timer = setTimeout(() => finish(false), Math.max(0, OPEN_SLOW_ACK_MS - (Date.now() - started)));
      }
    }
    let timer = setTimeout(() => finish(false), OPEN_ACK_MS);
    window.addEventListener("message", onMessage);
  });
}

/**
 * «Перенести из кампуса»: сообщить расширению группу и язык и открыть кампус.
 *
 *  - без `open` — только сообщение (кампус откроет ссылка сама, например в новой вкладке по Ctrl+клику);
 *  - `open` с расширением 0.4.1+ — сообщение с open: true: расширение переводит уже открытую
 *    вкладку кампуса на нужный адрес и выводит вперёд, а если не ответило — открываем сами;
 *  - `open` со старым расширением — просто открываем кампус в окне CAMPUS_TARGET.
 */
export function startCampusTransfer(
  title: string,
  lang: string,
  open?: { url: string; extensionOpens: boolean },
): void {
  lastTransferAt = Date.now();
  const message = { source: PAGE_SOURCE, type: "campus-intent", title, lang };
  if (!open) {
    window.postMessage(message, window.location.origin);
    return;
  }
  const fallback = () => {
    if (openCampusWindow(open.url)) return;
    // Браузер не пустил: подсказка снова зовёт нажать, а ссылка дальше работает сама.
    openBlocked = true;
    lastTransferAt = 0;
    window.dispatchEvent(new Event(CAMPUS_BLOCKED_EVENT));
  };
  if (!open.extensionOpens) {
    window.postMessage(message, window.location.origin);
    fallback();
    return;
  }
  const acked = waitForOpenAck();
  window.postMessage({ ...message, open: true }, window.location.origin);
  void acked.then((opened) => {
    if (!opened) fallback();
  });
}

/**
 * Нажатие на ссылку «Перенести из кампуса». Обычный клик перехватываем: кампус
 * открывает расширение или окно CAMPUS_TARGET, а не новая вкладка каждый раз.
 * Ctrl/Shift/средняя кнопка и случай «браузер не дал открыть» — как у обычной
 * ссылки, сообщение расширению уходит в любом случае.
 */
export function campusLinkClick(
  event: ReactMouseEvent<HTMLAnchorElement>,
  args: { title: string; lang: string; version: string | null },
): void {
  const modified = event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
  if (modified || openBlocked) {
    startCampusTransfer(args.title, args.lang);
    return;
  }
  event.preventDefault();
  startCampusTransfer(args.title, args.lang, {
    url: campusScheduleUrl(args.lang),
    extensionOpens: supportsOpenTab(args.version),
  });
}

/** Перенос запущен недавно — подсказка показывает «кампус открылся…», а не приглашение. */
export function transferRecentlyStarted(): boolean {
  return lastTransferAt > 0 && Date.now() - lastTransferAt < 10 * 60 * 1000;
}
