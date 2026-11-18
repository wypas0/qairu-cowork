import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Раздача .ics и вебхука должна работать на Node-рантайме: там есть crypto и pg-драйвер.
  // undici — HTTP-клиент загрузки календарей с проверкой адреса при подключении.
  serverExternalPackages: ["postgres", "undici"],
  // Во фрейм сайт встраивают только он сам и Telegram Web (Mini App там живёт
  // во фрейме web.telegram.org). Чужая страница, накрывшая наши кнопки
  // прозрачным фреймом, ничего не нажмёт за человека (clickjacking).
  // nosniff — браузер не угадывает тип файла (загруженное не исполнится как
  // скрипт); Referrer-Policy — на чужие сайты уходит только домен, без пути
  // (в пути бывает код группы).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'self' https://*.telegram.org" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      // Архив расширения сохраняется под именем из гайда (EXTENSION_ZIP_NAME в
      // src/core/extensionImport.ts): имя из заголовка браузер ставит выше
      // атрибута download у ссылки, а по нему называется папка после «Извлечь всё».
      {
        source: "/downloads/qairu-schedule-ext.zip",
        headers: [{ key: "Content-Disposition", value: 'attachment; filename="QairuCowork-extension.zip"' }],
      },
    ];
  },
};

export default nextConfig;
