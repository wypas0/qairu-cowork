"use client";

type ToastNode = HTMLDivElement & { _timer?: ReturnType<typeof setTimeout>; _hold?: boolean };

/** Кнопка в тосте — «Вернуть» после отказа: отмена вместо окна «Ты уверен?». */
export type ToastAction = { label: string; run: () => void };

/** Сколько живёт тост с кнопкой: успеть заметить и нажать «Вернуть». */
export const ACTION_TOAST_MS = 5000;

/**
 * Короткое всплывающее уведомление внизу экрана — рядом с большим пальцем и
 * с местом, где человек только что нажимал, а не плашкой вверху страницы.
 * Ошибка висит дольше и отмечена цветом; тост с кнопкой — 5 секунд, и
 * пока на нём курсор или фокус, не уходит: до «Вернуть» успевают дойти
 * и с клавиатуры.
 */
export function toast(text: string, tone: "ok" | "error" = "ok", action?: ToastAction): void {
  if (typeof document === "undefined") return;
  let node = document.querySelector<ToastNode>(".toast");
  if (!node) {
    node = document.createElement("div") as ToastNode;
    node.className = "toast";
    node.setAttribute("role", "status");
    node.setAttribute("aria-live", "polite");
    const held = node;
    const hold = () => {
      if (!held.classList.contains("has-action")) return;
      held._hold = true;
      if (held._timer) clearTimeout(held._timer);
    };
    const release = () => {
      if (!held._hold) return;
      held._hold = false;
      held._timer = setTimeout(() => held.classList.remove("show"), ACTION_TOAST_MS);
    };
    node.addEventListener("pointerenter", hold);
    node.addEventListener("focusin", hold);
    node.addEventListener("pointerleave", release);
    node.addEventListener("focusout", release);
    document.body.appendChild(node);
  }
  const current = node;
  current._hold = false;
  const label = document.createElement("span");
  label.textContent = text;
  current.replaceChildren(label);
  if (action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "toast-action";
    button.textContent = action.label;
    button.addEventListener(
      "click",
      () => {
        current.classList.remove("show");
        action.run();
      },
      { once: true },
    );
    current.append(button);
  }
  current.classList.toggle("error", tone === "error");
  current.classList.toggle("has-action", Boolean(action));
  current.classList.add("show");
  if (current._timer) clearTimeout(current._timer);
  const ms = action ? ACTION_TOAST_MS : tone === "error" ? 4500 : 2600;
  current._timer = setTimeout(() => current.classList.remove("show"), ms);
}
