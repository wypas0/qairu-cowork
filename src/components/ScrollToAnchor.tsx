"use client";

import { useEffect } from "react";

/**
 * Прокрутить к блоку после действия формы.
 *
 * Редирект из серверного действия теряет `#якорь`, и после «Да» на встрече
 * страница прыгала в самый верх. Якорь приходит параметром `?at=`.
 */
export function ScrollToAnchor({ id }: { id: string | null }) {
  useEffect(() => {
    if (!id || !/^[a-z0-9-]+$/.test(id)) return;
    document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, [id]);
  return null;
}
