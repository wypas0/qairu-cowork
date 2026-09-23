"use client";

import { useEffect, useState } from "react";

import { PICK_EVENT } from "./pick";

export type GroupTabKey = "time" | "meetings" | "members" | "settings";

export type GroupTabLabels = Record<GroupTabKey, string>;

const ORDER: GroupTabKey[] = ["time", "meetings", "members", "settings"];

/**
 * Разделы страницы группы.
 *
 * Страница отвечала на четыре разных вопроса подряд одной простынёй, и главный
 * — «когда мы можем встретиться» — оказывался третьим. Разделы меняют
 * содержимое, но не адрес, поэтому это вкладки, а не ссылки: серверные
 * действия возвращают человека на ту же страницу, и вкладку мы восстанавливаем
 * по параметру `at`, который они уже передают.
 *
 * Содержимое приходит готовыми узлами с сервера — здесь только переключение.
 */
export function GroupTabs({
  labels,
  initial,
  panels,
  badges = {},
}: {
  labels: GroupTabLabels;
  initial: GroupTabKey;
  panels: Record<GroupTabKey, React.ReactNode>;
  /** Сколько ждёт внимания в разделе — например, встречи без твоего ответа. */
  badges?: Partial<Record<GroupTabKey, number>>;
}) {
  const [active, setActive] = useState<GroupTabKey>(initial);

  // Ссылка вида /g/slug#meeting-12 из уведомления должна открыть нужный раздел.
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith("#meeting-")) setActive("meetings");
    else if (hash === "#members") setActive("members");
  }, []);

  // «Назначить» подставляет время в форму встречи — её и показываем.
  useEffect(() => {
    const open = () => setActive("meetings");
    window.addEventListener(PICK_EVENT, open);
    return () => window.removeEventListener(PICK_EVENT, open);
  }, []);

  return (
    <>
      <div className="tabs" role="tablist">
        {ORDER.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`tab-${key}`}
            aria-selected={active === key}
            aria-controls={`panel-${key}`}
            className={`tab${active === key ? " active" : ""}`}
            onClick={() => setActive(key)}
          >
            {labels[key]}
            {badges[key] ? <span className="count-badge">{badges[key]}</span> : null}
          </button>
        ))}
      </div>

      {ORDER.map((key) => (
        <div
          key={key}
          role="tabpanel"
          id={`panel-${key}`}
          aria-labelledby={`tab-${key}`}
          hidden={active !== key}
        >
          {panels[key]}
        </div>
      ))}
    </>
  );
}
