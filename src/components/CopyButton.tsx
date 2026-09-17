"use client";

import { toast } from "./toast";

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
    <button
      className={`btn${small ? " btn-sm" : ""}`}
      type="button"
      style={{ flex: "0 0 auto" }}
      onClick={copy}
    >
      {label}
    </button>
  );
}
