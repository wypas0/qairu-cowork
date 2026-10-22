"use client";

import { useLayoutEffect, useRef, useState } from "react";

import { slideIn, useThumb } from "./motion";

export type PageTab = { key: string; label: string; badge?: number };

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
  const [active, setActive] = useState(tabs.some((tab) => tab.key === initial) ? initial : tabs[0]!.key);
  const list = useRef<HTMLDivElement>(null);
  const enter = useRef<1 | -1 | null>(null);
  useThumb(list, active);

  useLayoutEffect(() => {
    const direction = enter.current;
    enter.current = null;
    if (direction !== null) slideIn(document.getElementById(`panel-${active}`), direction);
  }, [active]);

  function choose(key: string) {
    if (key === active) return;
    const order = tabs.map((tab) => tab.key);
    enter.current = order.indexOf(key) > order.indexOf(active) ? 1 : -1;
    setActive(key);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", key);
    window.history.replaceState(window.history.state, "", url);
  }

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
