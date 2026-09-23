import Link from "next/link";

import { BrandMark } from "./icons";

/**
 * Шапка без данных — только знак и название. Для страниц, которым незачем
 * ходить в базу: ошибка, «не найдено». Полная шапка (Topbar) спрашивает
 * вошедшего и его группы, а «не найдено» Next отрисовывает на каждом запросе.
 */
export function BrandBar() {
  return (
    <header className="topbar">
      <Link className="brand" href="/">
        <BrandMark className="brand-mark" />
        <span>
          Qairu<b>Cowork</b>
        </span>
      </Link>
    </header>
  );
}
