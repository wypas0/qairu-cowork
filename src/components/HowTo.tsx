"use client";

import { useState } from "react";

import { HOWTO_COOKIE, parseHowto, setViewCookie } from "@/lib/cookies";
import { IconChevronRight, IconHelp } from "./icons";

/** Запомнить, раскрыто ли описание `id`, — в куке, рядом с остальными раскрытыми. */
function remember(id: string, open: boolean): void {
  const current = document.cookie
    .split("; ")
    .find((part) => part.startsWith(`${HOWTO_COOKIE}=`))
    ?.slice(HOWTO_COOKIE.length + 1);
  const keys = new Set(parseHowto(current));
  if (open) keys.add(id);
  else keys.delete(id);
  setViewCookie(HOWTO_COOKIE, keys.size ? [...keys].join(".") : null);
}

/**
 * «Как это работает» — тихая строка над разделом: свёрнута, пока её не
 * откроют; раскрытая — несколько коротких шагов. Открытое остаётся открытым
 * на этом устройстве (кука — сервер сразу рисует как было, при загрузке
 * ничего не раскрывается). Тексты — в i18n (`w_howto_<id>_<n>`, см. HowToHint).
 */
export function HowTo({
  id,
  title,
  steps,
  initialOpen = false,
}: {
  id: string;
  title: string;
  steps: string[];
  initialOpen?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  if (steps.length === 0) return null;
  return (
    <details
      className="howto"
      data-howto={id}
      open={open}
      onToggle={(event) => {
        const next = event.currentTarget.open;
        if (next === open) return;
        setOpen(next);
        remember(id, next);
      }}
    >
      <summary className="howto-head">
        <IconHelp size={15} />
        <span>{title}</span>
        <IconChevronRight size={14} className="howto-icon" />
      </summary>
      <ol className="howto-steps">
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </details>
  );
}
