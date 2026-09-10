"use client";

type ToastNode = HTMLDivElement & { _timer?: ReturnType<typeof setTimeout> };

/** Короткое всплывающее уведомление внизу экрана. */
export function toast(text: string): void {
  if (typeof document === "undefined") return;
  let node = document.querySelector<ToastNode>(".toast");
  if (!node) {
    node = document.createElement("div") as ToastNode;
    node.className = "toast";
    document.body.appendChild(node);
  }
  node.textContent = text;
  node.classList.add("show");
  if (node._timer) clearTimeout(node._timer);
  const current = node;
  current._timer = setTimeout(() => current.classList.remove("show"), 2200);
}
