import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/config";

// Адрес сайта — из переменных при запросе, а не тот, что был при сборке.
export const dynamic = "force-dynamic";

/**
 * robots.txt. Закрыты страницы групп и друзей (код группы и личная ссылка в
 * адресе — это пропуск), API и вход. `/admin` здесь нарочно нет: консоль
 * владельца для чужих неотличима от 404, а robots выдал бы её адрес.
 */
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl() || "http://localhost:3000";
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/g/", "/f/", "/friends", "/api/", "/login", "/account", "/connect"],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
