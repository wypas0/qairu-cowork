import "server-only";

import * as repo from "@/db/repo";
import type { User } from "@/db/schema";

/**
 * Куда вести человека после того, как он представился в группе.
 *
 * Расписание принадлежит человеку, а не группе: одно на все его группы. Если
 * оно уже заполнено — например, когда вступали в другую группу, — снова
 * отправлять человека в редактор незачем, он просто увидит группу.
 */
export async function afterNamePath(slug: string, userId: number): Promise<string> {
  const filled = (await repo.filledIds([userId])).has(userId);
  return filled ? `/g/${slug}?welcome=schedule` : `/g/${slug}/me`;
}

/**
 * Куда вести человека сразу после вступления в группу: сперва один вопрос
 * «как тебя подписать», если он ещё ни разу на него не отвечал, потом — дальше.
 */
export async function afterJoinPath(slug: string, user: Pick<User, "userId" | "realName">): Promise<string> {
  if (!user.realName) return `/g/${slug}/welcome`;
  return afterNamePath(slug, user.userId);
}
