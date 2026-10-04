"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { SIDEBAR_COOKIE, setViewCookie } from "@/lib/cookies";
import { IconSidebar } from "./icons";

/**
 * Свернуть и развернуть левую панель. Свёрнутая панель не пропадает, а
 * становится узкой полосой со знаками групп — на них по-прежнему видны
 * счётчики, и в группу можно перейти одним нажатием. Выбор запоминается
 * кукой, поэтому следующая страница сразу приходит в том же виде.
 * Ctrl+\ (⌘+\ на Mac) — то же с клавиатуры.
 *
 * Мышь на свёрнутой полосе раскрывает панель поверх доски (класс
 * .sidebar-peek), ушла с неё — панель снова полоса. Доска под ней не
 * сдвигается, а кука не меняется: это подсмотреть, а не развернуть.
 *
 * При увеличении 125% и больше (страница 1024–1179 px) панель всегда полоса
 * (CSS в shell.css) — карте нужно место. Там кнопка и наведение только
 * подсматривают: раскрыть панель насовсем на такой ширине нельзя.
 */
const NARROW = "(min-width: 1024px) and (max-width: 1179px)";
const isNarrow = () => window.matchMedia(NARROW).matches;
const subscribeNarrow = (change: () => void) => {
  const query = window.matchMedia(NARROW);
  query.addEventListener("change", change);
  return () => query.removeEventListener("change", change);
};

export function SidebarToggle({
  initialClosed,
  labels,
}: {
  initialClosed: boolean;
  labels: { collapse: string; expand: string };
}) {
  const [closed, setClosed] = useState(initialClosed);
  const narrow = useSyncExternalStore(subscribeNarrow, isNarrow, () => false);
  const current = useRef(initialClosed);
  const button = useRef<HTMLButtonElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  function peek(on: boolean) {
    const shell = button.current?.closest(".shell");
    if (!shell) return;
    // Узкая страница: полосу держит CSS, мы только раскрываем её поверх.
    if (isNarrow()) {
      shell.classList.toggle("sidebar-peek", on);
      return;
    }
    if (!current.current) return;
    shell.classList.toggle("sidebar-closed", !on);
    shell.classList.toggle("sidebar-peek", on);
  }

  function apply(next: boolean) {
    clearTimeout(hoverTimer.current);
    if (isNarrow()) {
      const shell = button.current?.closest(".shell");
      peek(!shell?.classList.contains("sidebar-peek"));
      return;
    }
    current.current = next;
    setClosed(next);
    const shell = button.current?.closest(".shell");
    shell?.classList.remove("sidebar-peek");
    shell?.classList.toggle("sidebar-closed", next);
    setViewCookie(SIDEBAR_COOKIE, next ? "closed" : null);
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && (current.current || isNarrow()) && !document.querySelector("dialog[open], .profile-overlay")) {
        clearTimeout(hoverTimer.current);
        peek(false);
        return;
      }
      if (event.key !== "\\" || !(event.ctrlKey || event.metaKey) || event.altKey) return;
      event.preventDefault();
      apply(!current.current);
    }
    // Небольшая задержка: мышь, мимоходом задевшая край экрана, панель не
    // раскрывает, а короткий выход за её край не сворачивает. Панель профиля
    // открывается внутри сайдбара, поэтому мышь над ней его не сворачивает.
    function onHover(event: PointerEvent) {
      if (event.pointerType !== "mouse" || !(current.current || isNarrow())) return;
      const inside = event.type === "pointerenter";
      clearTimeout(hoverTimer.current);
      hoverTimer.current = setTimeout(() => peek(inside), inside ? 80 : 200);
    }
    const sidebar = button.current?.closest(".sidebar");
    window.addEventListener("keydown", onKey);
    sidebar?.addEventListener("pointerenter", onHover as EventListener);
    sidebar?.addEventListener("pointerleave", onHover as EventListener);
    return () => {
      clearTimeout(hoverTimer.current);
      window.removeEventListener("keydown", onKey);
      sidebar?.removeEventListener("pointerenter", onHover as EventListener);
      sidebar?.removeEventListener("pointerleave", onHover as EventListener);
    };
    // apply и peek пишут только в ref, состояние, классы и куку — пересоздавать слушатели незачем.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = closed || narrow;
  const label = shown ? labels.expand : labels.collapse;
  return (
    <button
      ref={button}
      type="button"
      className="icon-btn sidebar-toggle"
      aria-label={label}
      title={label}
      aria-expanded={!shown}
      aria-controls="sidebar"
      onClick={() => apply(!current.current)}
    >
      <IconSidebar size={18} />
    </button>
  );
}
