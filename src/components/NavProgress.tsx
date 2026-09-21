"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Тонкая полоска загрузки вверху экрана при переходе между страницами.
 *
 * Страницы группы собираются на сервере на лету, и на медленной сети после
 * нажатия на ссылку ничего не происходило — непонятно, сработало ли нажатие.
 * Скелетон через loading.tsx здесь не подошёл: граница Suspense вокруг
 * страницы оставляла её содержимое неживым после загрузки. Полоска не
 * вмешивается в отрисовку страницы вовсе.
 */
export function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const safety = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Начало — нажатие на внутреннюю ссылку, ведущую на другую страницу.
  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.("a[href]");
      if (!(link instanceof HTMLAnchorElement) || link.target === "_blank" || link.hasAttribute("download")) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      setState("loading");
      if (safety.current) clearTimeout(safety.current);
      // Если переход так и не случился (ошибка сети), полоска не должна висеть вечно.
      safety.current = setTimeout(() => setState("idle"), 15000);
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // Конец — сменился адрес: новая страница уже на экране.
  useEffect(() => {
    setState((current) => (current === "loading" ? "done" : current));
  }, [pathname, search]);

  useEffect(() => {
    if (state !== "done") return;
    if (safety.current) clearTimeout(safety.current);
    const timer = setTimeout(() => setState("idle"), 250);
    return () => clearTimeout(timer);
  }, [state]);

  if (state === "idle") return null;
  return <div className={`nav-progress ${state}`} role="progressbar" aria-busy={state === "loading"} />;
}
