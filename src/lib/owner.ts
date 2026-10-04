import "server-only";

import { alertChatId } from "./config";

/**
 * Владелец сайта — тот, кому бот шлёт алерты: ALERT_CHAT_ID в личке — это его
 * id в Telegram. Плюс необязательный список OWNER_IDS («123,456»), если
 * алерты уходят в рабочий чат. Отдельной роли в базе нет: владельцу нужна
 * только статистика (/admin/stats).
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
