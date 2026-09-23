import type { Instrumentation } from "next";

/**
 * Каждая ошибка сервера — страницы, route handler, серверного действия —
 * уходит алертом от бота (lib/alerts). Модуль грузится при первой ошибке,
 * а не при старте функции. Весь сайт работает на Node: в edge-сборку
 * инструментации алерты не попадают (условие вырезается при сборке).
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { reportServerError } = await import("./lib/alerts");
    await reportServerError(error, request, context);
  }
};
