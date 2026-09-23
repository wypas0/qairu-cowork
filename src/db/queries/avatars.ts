/** Фото профиля. */

import "server-only";

import { eq } from "drizzle-orm";
import { avatars } from "../schema";
import { type Exec, ex } from "./base";

// --------------------------------------------------------------------------
// Фото профиля
// --------------------------------------------------------------------------

export async function setAvatar(
  userId: number,
  avatar: { mime: string; base64: string },
  exec?: Exec,
): Promise<number> {
  const now = new Date();
  await ex(exec)
    .insert(avatars)
    .values({ userId, mime: avatar.mime, data: avatar.base64, updatedAt: now })
    .onConflictDoUpdate({
      target: avatars.userId,
      set: { mime: avatar.mime, data: avatar.base64, updatedAt: now },
    });
  return now.getTime();
}

export async function getAvatar(
  userId: number,
  exec?: Exec,
): Promise<{ mime: string; data: Buffer; updatedAt: Date } | null> {
  const [row] = await ex(exec).select().from(avatars).where(eq(avatars.userId, userId)).limit(1);
  return row ? { mime: row.mime, data: Buffer.from(row.data, "base64"), updatedAt: row.updatedAt } : null;
}

/**
 * Метка версии фото (время обновления в мс) без самих данных — для адреса
 * `/api/avatar/<id>?v=<версия>`, который можно кэшировать навсегда. null — фото нет.
 */
export async function avatarVersion(userId: number, exec?: Exec): Promise<number | null> {
  const [row] = await ex(exec)
    .select({ updatedAt: avatars.updatedAt })
    .from(avatars)
    .where(eq(avatars.userId, userId))
    .limit(1);
  return row ? row.updatedAt.getTime() : null;
}

export async function deleteAvatar(userId: number, exec?: Exec): Promise<void> {
  await ex(exec).delete(avatars).where(eq(avatars.userId, userId));
}
