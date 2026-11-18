"use client";

import { GROUPS_EVENT } from "../LandingShell";

/**
 * «У меня есть код» у вошедшего: поле кода живёт в сайдбаре групп, кнопка
 * открывает его тем же событием, что и «Мои группы» в шапке телефона.
 */
export function OpenGroupsButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="btn"
      aria-controls="sidebar"
      onClick={() => window.dispatchEvent(new Event(GROUPS_EVENT))}
    >
      {label}
    </button>
  );
}
