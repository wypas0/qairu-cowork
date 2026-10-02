"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { BrandMark, IconClose } from "./icons";

/** Событие «открой сайдбар групп» — его шлёт кнопка «Мои группы» в шапке телефона. */
export const GROUPS_EVENT = "qairu:groups";

/**
 * Лендинг для вошедшего: витрина на всю страницу, а группы — в сайдбаре,
 * который выезжает поверх неё.
 *
 * На компьютере сайдбар свёрнут в полосу со знаками групп, как свёрнутая
 * панель на страницах группы: сразу видно, что ты вошёл и где твои группы.
 * Мышь на полосе — сайдбар раскрывается поверх витрины, ушла с него —
 * сворачивается. Без мыши (сенсорный экран) полосу раскрывает нажатие.
 * На телефоне полосы нет (она отняла бы ширину у витрины) — сайдбар выезжает
 * по кнопке «Мои группы» в шапке. Закрывается крестиком, нажатием по фону и
 * клавишей Esc.
 */
export function LandingShell({
  sidebar,
  topbar,
  children,
  initialOpen,
  labels,
}: {
  sidebar: React.ReactNode;
  topbar: React.ReactNode;
  children: React.ReactNode;
  /** Открыть сразу: например, вернулись с ошибкой кода группы — она в сайдбаре. */
  initialOpen: boolean;
  labels: { groups: string; open: string; close: string };
}) {
  // "hover" — раскрыт наведением мыши: без затемнения фона и без переноса фокуса,
  // это просто подсмотреть. "pinned" — раскрыт нажатием, кнопкой или сразу.
  const [open, setOpen] = useState<false | "hover" | "pinned">(initialOpen ? "pinned" : false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  // Небольшая задержка: мышь, мимоходом задевшая край экрана, сайдбар не
  // раскрывает, а короткий выход за его край не сворачивает.
  function onHover(event: React.PointerEvent, inside: boolean) {
    if (event.pointerType !== "mouse") return;
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(
      () => setOpen((now) => (inside ? now || "hover" : false)),
      inside ? 80 : 200,
    );
  }

  useEffect(() => {
    const show = () => setOpen("pinned");
    // «Создать группу» открывает окно поверх — сайдбар ему не нужен.
    const onHash = () => {
      if (window.location.hash === "#create") setOpen(false);
    };
    window.addEventListener(GROUPS_EVENT, show);
    window.addEventListener("hashchange", onHash);
    return () => {
      window.removeEventListener(GROUPS_EVENT, show);
      window.removeEventListener("hashchange", onHash);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    if (open === "pinned") closeRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      // Esc над окном «Создать группу» закрывает только окно.
      if (event.key === "Escape" && !document.querySelector("dialog[open]")) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className={`shell landing-shell ${open ? "landing-open" : "sidebar-closed"}`}>
      <aside
        className="sidebar"
        id="sidebar"
        aria-label={labels.groups}
        // Панель профиля открывается внутри сайдбара, поэтому мышь над ней
        // сайдбар не сворачивает.
        onPointerEnter={(event) => onHover(event, true)}
        onPointerLeave={(event) => onHover(event, false)}
        // Свёрнутая полоса целиком — кнопка «развернуть» (для сенсорного экрана,
        // мышь раскрывает её раньше): знак группы сначала раскрывает сайдбар,
        // а не уводит со страницы. Профиль внизу работает как есть.
        onClickCapture={(event) => {
          if (open || (event.target as Element).closest(".sidebar-foot")) return;
          event.preventDefault();
          event.stopPropagation();
          clearTimeout(hoverTimer.current);
          setOpen("pinned");
        }}
        title={open ? undefined : labels.open}
      >
        <div className="sidebar-top">
          <Link className="brand sidebar-brand" href="/">
            <BrandMark className="brand-mark" />
            <span className="sidebar-label">
              Qairu<b>Cowork</b>
            </span>
          </Link>
          <button
            ref={closeRef}
            type="button"
            className="icon-btn sidebar-toggle landing-close"
            aria-label={labels.close}
            title={labels.close}
            onClick={() => setOpen(false)}
          >
            <IconClose size={18} />
          </button>
        </div>
        {sidebar}
      </aside>
      {open === "pinned" && <div className="landing-scrim" aria-hidden="true" onClick={() => setOpen(false)} />}
      <div className="shell-main">
        {topbar}
        {children}
      </div>
    </div>
  );
}

/** Кнопка «Мои группы» в шапке телефона: открывает тот же сайдбар. */
export function GroupsButton({ label, count }: { label: string; count: number }) {
  return (
    <button
      type="button"
      className="btn btn-sm landing-groups-btn"
      aria-controls="sidebar"
      onClick={() => window.dispatchEvent(new Event(GROUPS_EVENT))}
    >
      {label}
      {count > 0 && <span className="count-badge">{count}</span>}
    </button>
  );
}
