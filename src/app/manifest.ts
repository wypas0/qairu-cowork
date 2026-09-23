import type { MetadataRoute } from "next";

/**
 * Манифест: сайт можно установить как приложение — иконка на домашнем
 * экране, отдельное окно без адресной строки. Внутри Telegram то же даёт
 * «Добавить на главный экран» мини-аппа.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "QairuCowork",
    short_name: "QairuCowork",
    description: "Общие свободные окна учебной группы и встречи в один клик.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f4f6fa",
    theme_color: "#0064e0",
    lang: "ru",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
