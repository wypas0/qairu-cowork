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
    let timer: ReturnType<typeof setTimeout>;
    let tries = 0;

    // Нужный блок может лежать в разделе, который ещё не открыт: вкладки
    // переключаются своим эффектом, поэтому ждём, пока блок станет видимым.
    function go() {
      const node = document.getElementById(id!);
      if (node && node.offsetParent !== null) {
        node.scrollIntoView({ block: "start" });
        return;
      }
      if (tries++ < 10) timer = setTimeout(go, 50);
    }

    timer = setTimeout(go, 0);
    return () => clearTimeout(timer);
  }, [id]);
  return null;
}
