"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { calm, slideIn, useThumb } from "./motion";

/** badge — синий счётчик «ждёт тебя»; count — тихое число рядом с подписью («Друзья 3»). */
export type PageTab = { key: string; label: string; badge?: number; count?: number };

/** Переключить вкладку со страницы: { tab, focus? } — ключ и что поставить в фокус. */
const TAB_EVENT = "qairu:tab";
type TabRequest = { tab: string; focus?: string };

/**
 * Вкладки страницы — та же сегментированная панель, что у группы
 * (GroupTabs), но для любых разделов. Выбранная вкладка пишется в адрес
 * (`?tab=`): обновление страницы и возврат из действия открывают её же.
 * Содержимое приходит готовыми узлами с сервера — здесь только переключение.
 */
export function PageTabs({
  tabs,
  initial,
  panels,
  label,
}: {
  tabs: PageTab[];
  initial: string;
  panels: Record<string, React.ReactNode>;
  label: string;
}) {
  const known = (key: string) => tabs.some((tab) => tab.key === key);
  const [active, setActive] = useState(known(initial) ? initial : tabs[0]!.key);
  // Действие вернуло на ту же страницу с другим ?tab= — открываем его.
  const [seenInitial, setSeenInitial] = useState(initial);
  if (initial !== seenInitial) {
    setSeenInitial(initial);
    if (known(initial)) setActive(initial);
  }
  const list = useRef<HTMLDivElement>(null);
  const enter = useRef<1 | -1 | null>(null);
  const current = useRef(active);
  useThumb(list, active);

  useLayoutEffect(() => {
    current.current = active;
    const direction = enter.current;
    enter.current = null;
    if (direction !== null) slideIn(document.getElementById(`panel-${active}`), direction);
  }, [active]);

  function choose(key: string) {
    if (key === current.current || !known(key)) return;
    const order = tabs.map((tab) => tab.key);
    enter.current = order.indexOf(key) > order.indexOf(current.current) ? 1 : -1;
    setActive(key);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", key);
    window.history.replaceState(window.history.state, "", url);
  }

  // Кнопки на самой странице («Найти по нику» в пустом списке) — см. TabLink.
  useEffect(() => {
    function onRequest(event: Event) {
      const { tab, focus } = (event as CustomEvent<TabRequest>).detail;
      choose(tab);
      if (focus) requestAnimationFrame(() => document.querySelector<HTMLElement>(focus)?.focus());
    }
    window.addEventListener(TAB_EVENT, onRequest);
    return () => window.removeEventListener(TAB_EVENT, onRequest);
  });

  return (
    <>
      <div className="tabs" role="tablist" aria-label={label} ref={list}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            id={`tab-${tab.key}`}
            aria-selected={active === tab.key}
            aria-controls={`panel-${tab.key}`}
            className={`tab${active === tab.key ? " active" : ""}`}
            onClick={() => choose(tab.key)}
          >
            {tab.label}
            {tab.count !== undefined && <span className="tab-count">{tab.count}</span>}
            {tab.badge ? <span className="count-badge">{tab.badge}</span> : null}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div key={tab.key} role="tabpanel" id={`panel-${tab.key}`} aria-labelledby={`tab-${tab.key}`} hidden={active !== tab.key}>
          {panels[tab.key]}
        </div>
      ))}
    </>
  );
}

/**
 * Ссылка на другую вкладку той же страницы: без перезагрузки переключает её
 * и ставит фокус (`focus` — селектор). Без JS — обычная ссылка `?tab=`.
 */
export function TabLink({
  tab,
  focus,
  className,
  children,
}: {
  tab: string;
  focus?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <a
      className={className}
      href={`?tab=${tab}`}
      onClick={(event) => {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent<TabRequest>(TAB_EVENT, { detail: { tab, focus } }));
        window.scrollTo({ top: 0, behavior: calm() ? "auto" : "smooth" });
      }}
    >
      {children}
    </a>
  );
}
