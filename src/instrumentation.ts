import type { Instrumentation } from "next";

/**
 * Каждая ошибка сервера — страницы, route handler, серверного действия —
 * уходит алертом от бота (lib/alerts) и в счётчик «ошибок сервера» на
 * вкладке «Система» консоли (lib/metrics; обрыв со стороны человека не
 * считается). Модули грузятся при первой ошибке, а не при старте функции.
 * Весь сайт работает на Node: в edge-сборку инструментации алерты не
 * попадают (условие вырезается при сборке).
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const [{ clientGone, reportServerError }, metrics] = await Promise.all([
      import("./lib/alerts"),
      import("./lib/metrics"),
    ]);
    if (!clientGone(error)) metrics.countServerError();
    await Promise.all([reportServerError(error, request, context), metrics.flushMetrics()]);
  }
};
