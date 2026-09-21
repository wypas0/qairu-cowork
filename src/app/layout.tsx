import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { cookies, headers } from "next/headers";
import { Suspense } from "react";

import { NavProgress } from "@/components/NavProgress";
import { TelegramAuth } from "@/components/TelegramAuth";
import { TelegramChrome } from "@/components/TelegramChrome";
import { normalizeLang, t } from "@/i18n";
import { THEME_COOKIE, normalizeTheme } from "@/lib/theme";
import "./globals.css";

/* Единственный шрифт сайта. Кириллица подключена явно: без неё Inter
   отдаёт русские буквы системному шрифту, и заголовки едут по ширине. */
const inter = Inter({
  subsets: ["latin", "cyrillic"],
  display: "swap",
  variable: "--font-inter",
});

/* Знак продукта — то же кольцо с ножкой, что и в шапке (BrandMark). */
const FAVICON =
  "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none'><circle cx='11' cy='11' r='7' stroke='%230064e0' stroke-width='4'/><path d='M11 18h9' stroke='%230064e0' stroke-width='4'/></svg>";

export const metadata: Metadata = {
  title: "QairuCowork",
  description: "Находит общие свободные окна у студентов из одной группы.",
  icons: { icon: FAVICON },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "light dark",
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
        <footer className="foot">
          <span>{t(lang, "w_footer")}</span>
        </footer>
        {/* Скрипт Mini App должен загрузиться до того, как клиентский вход
            попробует прочитать window.Telegram.WebApp. */}
        <script src="https://telegram.org/js/telegram-web-app.js" async />
      </body>
    </html>
  );
}
