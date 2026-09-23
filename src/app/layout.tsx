import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { cookies, headers } from "next/headers";
import { Suspense } from "react";

import { NavProgress } from "@/components/NavProgress";
import { SiteFooter } from "@/components/SiteFooter";
import { TelegramAuth } from "@/components/TelegramAuth";
import { TelegramChrome } from "@/components/TelegramChrome";
import { normalizeLang } from "@/i18n";
import { BRAND_COLOR, brandMarkSvg } from "@/lib/brand";
import { siteUrl } from "@/lib/config";
import { THEME_COOKIE, normalizeTheme } from "@/lib/theme";
import "./globals.css";

/* Единственный шрифт сайта. Кириллица подключена явно: без неё Inter
   отдаёт русские буквы системному шрифту, и заголовки едут по ширине. */
const inter = Inter({
  subsets: ["latin", "cyrillic"],
  display: "swap",
  variable: "--font-inter",
});

/* Знак продукта — тот же, что в шапке (BrandMark), кобальтом. */
const FAVICON = `data:image/svg+xml,${encodeURIComponent(brandMarkSvg(BRAND_COLOR))}`;

export const metadata: Metadata = {
  // Полные адреса в превью ссылок (картинка, og:url) строятся от адреса сайта.
  metadataBase: new URL(siteUrl() || "http://localhost:3000"),
  title: "QairuCowork",
  description: "Находит общие свободные окна у студентов из одной группы.",
  // Превью ссылки в Telegram, WhatsApp, VK. Картинку рисует opengraph-image.tsx.
  openGraph: {
    type: "website",
    siteName: "QairuCowork",
    title: "QairuCowork",
    description: "Общие свободные окна учебной группы и встречи в один клик.",
    locale: "ru_RU",
  },
  twitter: { card: "summary_large_image" },
  icons: { icon: FAVICON, apple: "/icon-192.png" },
  // Установка на iPhone: «На экран Домой» открывает сайт отдельным окном.
  appleWebApp: { capable: true, title: "QairuCowork", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f6fa" },
    { media: "(prefers-color-scheme: dark)", color: "#070e1c" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const requestHeaders = await headers();
  const lang = normalizeLang((requestHeaders.get("accept-language") ?? "").split(",")[0]);
  const theme = normalizeTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    // suppressHydrationWarning: скрипт Telegram Mini App подставляет свои
    // CSS-переменные (--tg-viewport-height и т.п.) прямо в style этого узла,
    // иногда раньше, чем React успевает гидрироваться — это ожидаемо и не
    // баг гидратации.
    <html
      lang={lang}
      data-theme={theme === "system" ? undefined : theme}
      className={inter.variable}
      suppressHydrationWarning
    >
      <body>
        <TelegramAuth />
        <TelegramChrome />
        {/* useSearchParams требует своей границы — она охватывает только полоску, не страницу. */}
        <Suspense fallback={null}>
          <NavProgress />
        </Suspense>
        {children}
        {/* На страницах группы подвал рисует AppShell — в основной колонке. */}
        <SiteFooter lang={lang} />
        {/* Скрипт Mini App должен загрузиться до того, как клиентский вход
            попробует прочитать window.Telegram.WebApp. */}
        <script src="https://telegram.org/js/telegram-web-app.js" async />
      </body>
    </html>
  );
}
