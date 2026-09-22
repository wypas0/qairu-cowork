"use client";

import { useEffect, useRef, useState } from "react";

import { SIDEBAR_COOKIE, setViewCookie } from "@/lib/cookies";
import { IconSidebar } from "./icons";

/**
 * Свернуть и развернуть левую панель. Свёрнутая панель не пропадает, а
 * становится узкой полосой со знаками групп — на них по-прежнему видны
 * счётчики, и в группу можно перейти одним нажатием. Выбор запоминается
 * кукой, поэтому следующая страница сразу приходит в том же виде.
 * Ctrl+\ (⌘+\ на Mac) — то же с клавиатуры.
 */
export function SidebarToggle({
  initialClosed,
  labels,
}: {
  initialClosed: boolean;
  labels: { collapse: string; expand: string };
}) {
  const [closed, setClosed] = useState(initialClosed);
  const current = useRef(initialClosed);
  const button = useRef<HTMLButtonElement>(null);

  function apply(next: boolean) {
    current.current = next;
    setClosed(next);
    button.current?.closest(".shell")?.classList.toggle("sidebar-closed", next);
    setViewCookie(SIDEBAR_COOKIE, next ? "closed" : null);
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "\\" || !(event.ctrlKey || event.metaKey) || event.altKey) return;
      event.preventDefault();
      apply(!current.current);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // apply пишет только в ref, состояние и куку — пересоздавать слушатель незачем.
  }, []);

  const label = closed ? labels.expand : labels.collapse;
  return (
    <button
      ref={button}
      type="button"
      className="icon-btn sidebar-toggle"
      aria-label={label}
      title={label}
      aria-expanded={!closed}
      aria-controls="sidebar"
      onClick={() => apply(!closed)}
    >
      <IconSidebar size={18} />
    </button>
  );
}
