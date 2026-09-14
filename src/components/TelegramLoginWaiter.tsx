"use client";

import { useEffect, useState } from "react";

type Status = "pending" | "ok" | "rejected" | "expired" | "invalid";

/**
 * Ждёт подтверждения входа в боте: раз в 2 секунды спрашивает сервер.
 *
 * Как только бот подтвердил, сервер ставит куку сессии, и страница переходит
 * дальше. Работает и когда Telegram открыт на другом устройстве.
 */
export function TelegramLoginWaiter({
  labels,
}: {
  labels: { waiting: string; done: string; rejected: string; expired: string; invalid: string; retry: string };
}) {
  const [status, setStatus] = useState<Status>("pending");

  useEffect(() => {
    if (status !== "pending") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const response = await fetch("/api/tg-login/status", {
          credentials: "same-origin",
          cache: "no-store",
        });
        const data = (await response.json()) as { status: Status; next?: string };
        if (cancelled) return;
        if (data.status === "ok") {
          setStatus("ok");
          window.location.assign(data.next || "/");
          return;
        }
        if (data.status !== "pending") {
          setStatus(data.status);
          return;
        }
      } catch {
        // Сеть мигнула — просто попробуем ещё раз.
      }
      if (!cancelled) timer = setTimeout(poll, 2000);
    }

    timer = setTimeout(poll, 1500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [status]);

  if (status === "pending") {
    return (
      <p className="small muted waiting" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" /> {labels.waiting}
      </p>
    );
  }
  if (status === "ok") {
    return (
      <div className="notice" role="status">
        {labels.done}
      </div>
    );
  }
  return (
    <div className="notice warn" role="alert">
      {status === "rejected" ? labels.rejected : status === "expired" ? labels.expired : labels.invalid}{" "}
      <a href="/login">{labels.retry}</a>
    </div>
  );
}
