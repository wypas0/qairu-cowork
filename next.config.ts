import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Раздача .ics и вебхука должна работать на Node-рантайме: там есть crypto и pg-драйвер.
  serverExternalPackages: ["postgres"],
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
