import { appIcon } from "@/lib/appIcon";

/**
 * Аватар бота 640×640 — Telegram рекомендует этот размер. Скачать и загрузить
 * в BotFather (/setuserpic); сам Telegram эту картинку отсюда не берёт.
 */
export const dynamic = "force-static";

export function GET() {
  return appIcon(640);
}
