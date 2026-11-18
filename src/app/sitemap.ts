import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/config";

// Адрес сайта — из переменных при запросе, а не тот, что был при сборке.
export const dynamic = "force-dynamic";

/** Карта сайта: только открытые всем страницы — лендинг и установка расширения. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl() || "http://localhost:3000";
  return [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/extension`, changeFrequency: "monthly", priority: 0.5 },
  ];
}
