"use client";

import { createPortal } from "react-dom";

/**
 * Всплывающий слой — шторка, окно, подсказка — прямо в <body>.
 *
 * `position: fixed` считается от окна, только пока ни у одного предка нет
 * transform, filter или backdrop-filter: иначе слой встаёт относительно
 * этого предка и обрезается его размером. Шапка (размытие под ней) и
 * вкладка, которая въезжает сбоку, — как раз такие предки: панель профиля
 * из шапки сжималась до высоты шапки. В <body> слою ничто не мешает, а
 * события React по-прежнему всплывают по дереву компонентов.
 *
 * Слои показываются только после действия человека, поэтому на сервере
 * их нет; на всякий случай без document ничего не рисуем.
 */
export function Layer({ children }: { children: React.ReactNode }) {
  return typeof document === "undefined" ? null : createPortal(children, document.body);
}
