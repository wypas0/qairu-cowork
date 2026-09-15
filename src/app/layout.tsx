import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";

import { normalizeLang, t } from "@/i18n";
import { THEME_COOKIE, normalizeTheme } from "@/lib/theme";
import "./globals.css";

const FAVICON =
  "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🗓</text></svg>";

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
    <html lang={lang} data-theme={theme === "system" ? undefined : theme} suppressHydrationWarning>
      <body>
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
