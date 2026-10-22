"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { useExit } from "./motion";

/**
 * Кнопка с выпадающим списком действий — «⋯» у участника, «Позвать в
 * группу ▾» в карточке друга. Пункты приходят готовыми узлами с сервера:
 * ссылки и формы с серверными действиями.
 *
 * Не role="menu": внутри обычные ссылки и кнопки форм, и их семантику
 * незачем перекрашивать — это раскрывающийся блок (aria-expanded). Закрывается
 * по Esc, нажатием мимо и после выбора: отправки формы или перехода по
 * ссылке. Если пункт сам отменил нажатие (окно «Ты уверен?» Telegram ответит
 * позже), список не закрывается — форма должна дожить до ответа.
 *
 * Список прижат к краю кнопки (`align`); не влезает в экран — к другому:
 * на телефоне кнопка «Позвать в группу» уезжает под имя, к левому краю.
 */
export function Menu({
  label,
  children,
  icon,
  text,
  className = "btn btn-sm",
  align = "end",
  disabled = false,
}: {
  /** Подпись для скринридера и подсказка. */
  label: string;
  children: React.ReactNode;
  /** Значок вместо текста (кнопка «⋯»). */
  icon?: React.ReactNode;
  /** Видимый текст кнопки. */
  text?: React.ReactNode;
  className?: string;
  /** К какому краю кнопки прижат список. */
  align?: "start" | "end";
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState(align);
  const panel = useExit(open ? true : null);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();

  // До первой отрисовки: список сразу встаёт туда, где помещается.
  useLayoutEffect(() => {
    if (!open) return;
    const box = root.current?.querySelector(".menu-panel")?.getBoundingClientRect();
    if (!box) return;
    if (box.left < 8) setSide("start");
    else if (box.right > window.innerWidth - 8) setSide("end");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDown(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      root.current?.querySelector<HTMLButtonElement>(".menu-button")?.focus();
    }
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    // Клавиатура: фокус — на первый пункт.
    root.current?.querySelector<HTMLElement>(".menu-panel a, .menu-panel button:not(:disabled)")?.focus();
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Закрыть после выбора — но позже, чем форма уйдёт: иначе она стала бы inert раньше отправки.
  const closeSoon = () => setTimeout(() => setOpen(false), 0);

  return (
    <div className="menu" ref={root}>
      <button
        type="button"
        className={`${className} menu-button`}
        aria-expanded={open}
        aria-controls={id}
        aria-label={icon && !text ? label : undefined}
        title={icon && !text ? label : undefined}
        disabled={disabled}
        onClick={() => {
          setSide(align);
          setOpen((value) => !value);
        }}
      >
        {icon}
        {text}
      </button>
      {panel.shown && (
        <div
          id={id}
          className={`menu-panel menu-${side}`}
          data-leaving={panel.leaving || undefined}
          inert={panel.leaving}
          onSubmit={closeSoon}
          onClick={(event) => {
            if (!event.defaultPrevented && (event.target as Element).closest("a")) closeSoon();
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
