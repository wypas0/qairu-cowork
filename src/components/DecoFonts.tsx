"use client";

import { useEffect } from "react";

/**
 * Включает витринные шрифты (Oswald, Caveat) после загрузки страницы.
 * Они нужны только для украшений лендинга; если подключить их сразу,
 * браузер качает четыре лишних файла до первой отрисовки.
 */
export function DecoFonts() {
  useEffect(() => {
    const on = () => document.documentElement.classList.add("deco-fonts");
    if (document.readyState === "complete") {
      on();
      return;
    }
    window.addEventListener("load", on, { once: true });
    return () => window.removeEventListener("load", on);
  }, []);
  return null;
}
