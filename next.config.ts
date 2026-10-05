import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Раздача .ics и вебхука должна работать на Node-рантайме: там есть crypto и pg-драйвер.
  // undici — HTTP-клиент загрузки календарей с проверкой адреса при подключении.
  serverExternalPackages: ["postgres", "undici"],
  // Локальная разработка с ботом идёт через туннель Cloudflare (npm run dev:tg):
  // dev-сервер иначе не отдаёт свои ресурсы странице с адреса туннеля. На
  // продакшен-сборку эта настройка не действует.
  allowedDevOrigins: ["*.trycloudflare.com"],
  // Во фрейм сайт встраивают только он сам и Telegram Web (Mini App там живёт
  // во фрейме web.telegram.org). Чужая страница, накрывшая наши кнопки
  // прозрачным фреймом, ничего не нажмёт за человека (clickjacking).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'self' https://*.telegram.org" }],
      },
    ];
  },
};

export default nextConfig;
