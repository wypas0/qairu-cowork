"use client";

import { haptic, webApp } from "@/lib/telegram";

/**
 * Кнопка отправки формы, которая сначала спрашивает подтверждение.
 * Нужна для необратимых действий в серверных компонентах, где своих
 * обработчиков событий нет.
 *
 * В Telegram спрашиваем нативным окном: window.confirm внутри мини-аппа
 * выглядит чужим, а на части клиентов блокирует страницу целиком.
 */
export function ConfirmSubmit({
  confirm,
  className,
  children,
}: {
  confirm: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(event) => {
        const app = webApp();
        if (app?.showConfirm) {
          // Ответ придёт колбэком, поэтому отправку останавливаем всегда
          // и повторяем её руками, если человек согласился.
          event.preventDefault();
          const button = event.currentTarget;
          const form = button.form;
          app.showConfirm(confirm, (ok) => {
            if (!ok) return;
            haptic("press");
            form?.requestSubmit(button);
          });
          return;
        }
        if (!window.confirm(confirm)) event.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
