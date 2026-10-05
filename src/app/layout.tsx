import type { Metadata, Viewport } from "next";
import { Geologica, Onest } from "next/font/google";
import { headers } from "next/headers";
import { Suspense } from "react";

import { Motion } from "@/components/Motion";
import { NavProgress } from "@/components/NavProgress";
import { SiteFooter } from "@/components/SiteFooter";
import { TelegramAuth } from "@/components/TelegramAuth";
import { TelegramChrome } from "@/components/TelegramChrome";
import { normalizeLang } from "@/i18n";
import { BRAND_COLOR, brandMarkSvg } from "@/lib/brand";
import { siteUrl } from "@/lib/config";
import "./globals.css";

/* Два шрифта, две роли — как у лендинга QairuHub. Onest — текст и
   интерфейс: русский гротеск с полной кириллицей и казахскими буквами,
   читается на мелких размерах. Geologica — заголовки. Inter, сжатый капс
   Oswald и рукописный Caveat убраны (2026-10-02): три голоса на одной
   витрине спорили друг с другом. */
const body = Onest({
  subsets: ["latin", "cyrillic", "cyrillic-ext"],
  display: "swap",
  variable: "--font-body",
});
const display = Geologica({
  subsets: ["latin", "cyrillic", "cyrillic-ext"],
  display: "swap",
  variable: "--font-display",
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
  // Сайт светлый всегда (решение 2026-10-02): одна тема, без переключателя.
  colorScheme: "light",
  themeColor: "#f7f7f5",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const requestHeaders = await headers();
  const lang = normalizeLang((requestHeaders.get("accept-language") ?? "").split(",")[0]);

  return (
    // suppressHydrationWarning: скрипт Telegram Mini App подставляет свои
    // CSS-переменные (--tg-viewport-height и т.п.) прямо в style этого узла,
    // иногда раньше, чем React успевает гидрироваться — это ожидаемо и не
    // баг гидратации.
    <html
      lang={lang}
      className={`${body.variable} ${display.variable}`}
      suppressHydrationWarning
    >
      <body>
        <TelegramAuth />
        <TelegramChrome />
        <Motion />
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
