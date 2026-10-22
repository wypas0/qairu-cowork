"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

import { slideIn, useThumb } from "./motion";
import { PICK_EVENT } from "./pick";

export type GroupTabKey = "time" | "meetings" | "members" | "settings";

export type GroupTabLabels = Record<GroupTabKey, string>;

const ORDER: GroupTabKey[] = ["time", "meetings", "members", "settings"];

/** Раздел по якорю ссылки: `#meeting-12` из уведомления — встречи, `#members` — участники. */
function tabFromHash(hash: string): GroupTabKey | null {
  if (hash.startsWith("#meeting-")) return "meetings";
  if (hash === "#members") return "members";
  return null;
}

function subscribeHash(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

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
  // Вкладка, выбранная человеком, важнее якоря и начальной.
  const [chosen, setChosen] = useState<GroupTabKey | null>(null);
  // Ссылка вида /g/slug#meeting-12 из уведомления должна открыть нужный раздел.
  // Якоря сервер не видит: при гидратации он пустой, затем читается из адреса.
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => "");
  const active = chosen ?? tabFromHash(hash) ?? initial;

  // Подложка выбранной вкладки скользит к новой, а содержимое приходит с той
  // стороны, куда переключили. Только после действия человека: вкладка,
  // открытая якорем при загрузке, появляется без движения.
  const list = useRef<HTMLDivElement>(null);
  const shown = useRef(active);
  const enter = useRef<1 | -1 | null>(null);
  useThumb(list, active);

  function choose(key: GroupTabKey) {
    if (key !== shown.current) enter.current = ORDER.indexOf(key) > ORDER.indexOf(shown.current) ? 1 : -1;
    setChosen(key);
  }

  useLayoutEffect(() => {
    shown.current = active;
    const direction = enter.current;
    enter.current = null;
    if (direction !== null) slideIn(document.getElementById(`panel-${active}`), direction);
  }, [active]);

  // «Назначить» подставляет время в форму встречи — её и показываем.
  useEffect(() => {
    const open = () => choose("meetings");
    window.addEventListener(PICK_EVENT, open);
    return () => window.removeEventListener(PICK_EVENT, open);
  }, []);

  return (
    <>
      <div className="tabs" role="tablist" ref={list}>
        {ORDER.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`tab-${key}`}
            aria-selected={active === key}
            aria-controls={`panel-${key}`}
            className={`tab${active === key ? " active" : ""}`}
            onClick={() => choose(key)}
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
