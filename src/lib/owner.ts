import "server-only";

import { alertChatId } from "./config";

/**
 * Владелец сайта — тот, кому бот шлёт алерты: ALERT_CHAT_ID в личке — это его
 * id в Telegram. Плюс необязательный список OWNER_IDS («123,456»), если
 * алерты уходят в рабочий чат. Отдельной роли в базе нет: владельцу нужна
 * только консоль (/admin), и пускает туда не этот список сам по себе, а
 * второй фактор — код от бота (lib/ownerConsole).
 *
 * Хешировать id в переменных незачем: Telegram id не секрет (его видит любой
 * бот, с которым человек говорит, и участники общих групп), а ALERT_CHAT_ID
 * боту нужен открытым, чтобы писать. Защищает не тайна id, а то, что войти
 * под этим id можно только через Telegram, и код приходит в его же личку.
 */
export function ownerIds(): Set<number> {
  const ids = new Set<number>();
  const alert = Number(alertChatId());
  if (Number.isInteger(alert) && alert > 0) ids.add(alert);
  for (const part of (process.env.OWNER_IDS ?? "").split(",")) {
    const id = Number(part.trim());
    if (Number.isInteger(id) && id > 0) ids.add(id);
  }
  return ids;
}

export function isOwner(userId: number): boolean {
  return ownerIds().has(userId);
}
