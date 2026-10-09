/**
 * Ошибки сервера — сообщением от бота в ALERT_CHAT_ID (владельцу в личку или
 * в рабочий чат). На Vercel Hobby логи живут час: без алерта об упавшей
 * странице узнаёшь от пользователей, а в логах её уже нет.
 *
 * В сообщение идут метод, шаблон маршрута (`/api/calendar/[token]`, а не сам
 * путь — в путях бывают секреты), первая строка ошибки и digest — тот же код,
 * что человек видит на странице ошибки.
 */

import "server-only";

import { sendMessage } from "@/bot/api";
import { escapeHtml } from "@/core/textutils";
import { alertChatId, hasBot } from "./config";

/** Одна и та же ошибка на одном маршруте — не чаще раза в столько. */
const REPEAT_MS = 10 * 60 * 1000;
const lastSent = new Map<string, number>();

export type RequestInfo = { method: string };
export type ErrorContext = { routePath: string; routeType: string };

/** Не ошибки нашего кода: человек закрыл вкладку посреди ответа, оборвалась сеть. */
export function clientGone(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  return (
    error.name === "AbortError" ||
    code === "ECONNRESET" ||
    code === "EPIPE" ||
    /destination stream closed early|the operation was aborted/i.test(error.message)
  );
}

/** Сообщить об ошибке сервера. Сам не падает: алерт не должен ломать ответ. */
export async function reportServerError(error: unknown, request: RequestInfo, context: ErrorContext): Promise<void> {
  // Пусто или не число (NaN) — алерты выключены.
  const chatId = Number(alertChatId());
  if (!chatId || !hasBot() || clientGone(error)) return;

  const message = (error instanceof Error ? error.message : String(error)).split("\n")[0].slice(0, 300);
  const digest =
    typeof error === "object" && error !== null && "digest" in error ? String((error as { digest: unknown }).digest) : "";

  const key = `${context.routePath}|${message}`;
  const now = Date.now();
  if ((lastSent.get(key) ?? 0) > now - REPEAT_MS) return;
  lastSent.set(key, now);

  const text = [
    "⚠️ <b>Ошибка на сайте</b>",
    `${escapeHtml(request.method)} <code>${escapeHtml(context.routePath)}</code> · ${escapeHtml(context.routeType)}`,
    `<code>${escapeHtml(message)}</code>`,
    digest ? `digest: <code>${escapeHtml(digest)}</code>` : "",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    await sendMessage({ chat_id: chatId, text, parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  } catch {
    // Не дошло — останется запись в логах Vercel.
  }
}

/**
 * Расширение кампуса не нашло расписание на странице — значит, кампус сменил
 * формат и расширение у всех сломано. Поля уже проверены (`readExtensionReport`).
 */
export async function reportExtensionProblem(report: {
  version: string;
  locale: string;
  html: number;
  flight: number;
  grid: boolean;
  sections: number;
}): Promise<boolean> {
  const chatId = Number(alertChatId());
  if (!chatId || !hasBot()) return false;
  const text = [
    "⚠️ <b>Расширение кампуса не нашло расписание</b>",
    "Похоже, campus.qairu.edu.kz сменил формат страницы /schedule.",
    `версия ${escapeHtml(report.version)} · язык ${escapeHtml(report.locale)}`,
    `HTML ${report.html} · RSC ${report.flight} · ScheduleGrid: ${report.grid ? "есть" : "нет"} · "sections": ${report.sections}`,
  ].join("\n");
  try {
    await sendMessage({ chat_id: chatId, text, parse_mode: "HTML", link_preview_options: { is_disabled: true } });
    return true;
  } catch {
    return false;
  }
}

/**
 * Событие консоли владельца (/admin): вход, серия неверных кодов. Уходит в
 * ALERT_CHAT_ID, а если он не задан (владелец только из OWNER_IDS) — в личку
 * самому владельцу. Без антиповтора: каждый вход должен быть виден.
 */
export async function reportOwnerConsole(ownerId: number, lines: string[]): Promise<boolean> {
  if (!hasBot()) return false;
  const chatId = Number(alertChatId()) || ownerId;
  try {
    await sendMessage({
      chat_id: chatId,
      text: lines.join("\n"),
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
    return true;
  } catch {
    return false;
  }
}
