"use client";

import { toast } from "./toast";

export function CopyButton({
  value,
  label,
  copiedLabel,
}: {
  value: string;
  label: string;
  copiedLabel: string;
}) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      toast(copiedLabel);
    } catch {
      // Без разрешения на буфер обмена показываем ссылку — её можно выделить руками.
      window.prompt(copiedLabel, value);
    }
  }

  return (
    <button className="btn" type="button" style={{ flex: "0 0 auto" }} onClick={copy}>
      {label}
    </button>
  );
}
