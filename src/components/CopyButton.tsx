"use client";

import { useEffect, useRef, useState } from "react";

import { IconCheck } from "./icons";
import { toast } from "./toast";

/**
 * Кнопка «скопировать». Ответ — в самой кнопке (Kinetics, Copy Button):
 * подпись сменяется галочкой и «скопировано», через 1,6 с возвращается.
 * Обе подписи лежат в одной ячейке сетки, поэтому ширина кнопки не прыгает.
 * Тост нужен только длинному подтверждению («Окна скопированы — вставь в
 * чат группы»): это подсказка к следующему шагу, в кнопку она не помещается.
 */

/** Длиннее — в кнопке остаётся галочка у прежней подписи, текст уходит в тост. */
const INLINE_MAX = 18;
export function CopyButton({
  value,
  label,
  copiedLabel,
  small = false,
}: {
  value: string;
  label: string;
  copiedLabel: string;
  small?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const inline = copiedLabel.length <= INLINE_MAX;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (!inline) toast(copiedLabel);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      // Без разрешения на буфер обмена показываем ссылку — её можно выделить руками.
      window.prompt(copiedLabel, value);
    }
  }

  return (
    <button
      className={`btn copy-btn${small ? " btn-sm" : ""}${copied ? " copied" : ""}`}
      type="button"
      style={{ flex: "0 0 auto" }}
      onClick={copy}
    >
      <span className="copy-label">{label}</span>
      <span className="copy-done" aria-hidden={!copied}>
        <IconCheck size={16} />
        {inline ? copiedLabel : label}
      </span>
      {inline && (
        <span className="sr-only" role="status" aria-live="polite">
          {copied ? copiedLabel : ""}
        </span>
      )}
    </button>
  );
}
