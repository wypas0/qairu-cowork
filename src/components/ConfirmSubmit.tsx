"use client";

/**
 * Кнопка отправки формы, которая сначала спрашивает подтверждение.
 * Нужна для необратимых действий в серверных компонентах, где своих
 * обработчиков событий нет.
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
        if (!window.confirm(confirm)) event.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
