"use client";

type ToastNode = HTMLDivElement & { _timer?: ReturnType<typeof setTimeout> };

/**
 * Короткое всплывающее уведомление внизу экрана — рядом с большим пальцем и
 * с местом, где человек только что нажимал, а не плашкой вверху страницы.
 * Ошибка висит дольше и отмечена цветом.
 */
export function toast(text: string, tone: "ok" | "error" = "ok"): void {
  if (typeof document === "undefined") return;
  let node = document.querySelector<ToastNode>(".toast");
  if (!node) {
    node = document.createElement("div") as ToastNode;
    node.className = "toast";
    node.setAttribute("role", "status");
    node.setAttribute("aria-live", "polite");
    document.body.appendChild(node);
  }
  node.textContent = text;
  node.classList.toggle("error", tone === "error");
  node.classList.add("show");
  if (node._timer) clearTimeout(node._timer);
  const current = node;
  current._timer = setTimeout(() => current.classList.remove("show"), tone === "error" ? 4500 : 2600);
}
