"use client";

import { useEffect, useRef, useState } from "react";

import { slideIn, useThumb } from "../motion";

export type TileText = { lang: string; short: string; title: string; text: string };

/**
 * Плитка «Telegram, три языка, две темы»: сегменты «Рус · Қаз · Eng» меняют
 * язык текста самой плитки. Все три текста приходят с сервера.
 */
export function TileLangs({ texts, initial, label }: { texts: TileText[]; initial: string; label: string }) {
  const [lang, setLang] = useState(initial);
  const segRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const direction = useRef<1 | -1 | null>(null);
  const index = Math.max(
    0,
    texts.findIndex((item) => item.lang === lang),
  );
  const current = texts[index];
  useThumb(segRef, lang);

  useEffect(() => {
    if (direction.current !== null) slideIn(textRef.current, direction.current);
  }, [lang]);

  return (
    <>
      <div className="tile-lang" lang={current.lang} ref={textRef} key={current.lang}>
        <h3>{current.title}</h3>
        <p className="small muted">{current.text}</p>
      </div>
      <div className="tile-widget">
        <div className="seg" role="radiogroup" aria-label={label} ref={segRef}>
          {texts.map((item, at) => (
            <button
              key={item.lang}
              type="button"
              role="radio"
              lang={item.lang}
              aria-checked={item.lang === current.lang}
              className={item.lang === current.lang ? "active" : undefined}
              onClick={() => {
                if (item.lang === current.lang) return;
                direction.current = at > index ? 1 : -1;
                setLang(item.lang);
              }}
            >
              {item.short}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
