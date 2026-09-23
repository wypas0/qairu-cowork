/** Перенос аккаунта с сайта в Telegram. */

import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { avatars, botState, busySlots, chats, credentials, displayName, meetingResponses, meetings, memberships, notices, ROLE_ADMIN, ROLE_MEMBER, scheduleState, users, webSessions } from "../schema";
import { type Exec, ex, transaction } from "./base";
import { avatarVersion } from "./avatars";
import { getBotState } from "./botState";
import { getCredentials } from "./credentials";
import { getUser } from "./groups";
import { inviteeIds } from "./meetings";
import { isFilled, markFilled } from "./schedule";

// --------------------------------------------------------------------------
// Перенос аккаунта с сайта в Telegram
// --------------------------------------------------------------------------

/**
 * Перенести всё, что накопил аккаунт с сайта, в Telegram-аккаунт того же человека.
 *
 * Вызывается, когда человек, вошедший на сайт без Telegram (по ссылке-приглашению),
 * подтверждает вход через бота. Одна транзакция — либо перенесено всё, либо ничего.
 *
 * При конфликте побеждает Telegram-аккаунт: его расписание, ответ на встречу и
 * пароль остаются, сайтовые копии отбрасываются. Роль в группе — наибольшая из
 * двух: админство с сайта не теряется.
 */
export async function mergeWebUserIntoTelegram(
  webUserId: number,
  telegramUserId: number,
): Promise<boolean> {
  return transaction(async (tx) => {
    if (webUserId === telegramUserId) return false;
    const web = await getUser(webUserId, tx);
    const tg = await getUser(telegramUserId, tx);
    if (!web || !tg || !web.isWeb || tg.isWeb) return false;

    // Группы и роли.
    const webMemberships = await tx
      .select()
      .from(memberships)
      .where(eq(memberships.userId, webUserId));
    for (const membership of webMemberships) {
      await tx
        .insert(memberships)
        .values({
          chatId: membership.chatId,
          userId: telegramUserId,
          role: membership.role,
          joinedAt: membership.joinedAt,
        })
        .onConflictDoUpdate({
          target: [memberships.chatId, memberships.userId],
          set: {
            role: sql`case when excluded.role = ${ROLE_ADMIN} or ${memberships.role} = ${ROLE_ADMIN}
                           then ${ROLE_ADMIN} else ${memberships.role} end`,
          },
        });
    }
    await tx.delete(memberships).where(eq(memberships.userId, webUserId));
    await tx.update(chats).set({ createdBy: telegramUserId }).where(eq(chats.createdBy, webUserId));

    // Расписание: переносим, только если в Telegram его ещё нет.
    const [tgSlot] = await tx
      .select({ id: busySlots.id })
      .from(busySlots)
      .where(eq(busySlots.userId, telegramUserId))
      .limit(1);
    const tgHasSchedule = Boolean(tgSlot) || (await isFilled(telegramUserId, tx));
    if (!tgHasSchedule) {
      await tx.update(busySlots).set({ userId: telegramUserId }).where(eq(busySlots.userId, webUserId));
      const [webState] = await tx
        .select()
        .from(scheduleState)
        .where(eq(scheduleState.userId, webUserId))
        .limit(1);
      if (webState) await markFilled(telegramUserId, webState.filled, tx);
    }

    // Ответы на встречи: сайтовый ответ переносится туда, где Telegram-ответа нет.
    const tgAnswered = await tx
      .select({ meetingId: meetingResponses.meetingId })
      .from(meetingResponses)
      .where(eq(meetingResponses.userId, telegramUserId));
    const answeredIds = tgAnswered.map((row) => row.meetingId);
    await tx
      .update(meetingResponses)
      .set({ userId: telegramUserId })
      .where(
        and(
          eq(meetingResponses.userId, webUserId),
          answeredIds.length
            ? sql`${meetingResponses.meetingId} not in (${sql.join(answeredIds.map((id) => sql`${id}`), sql`, `)})`
            : sql`true`,
        ),
      );
    await tx.delete(meetingResponses).where(eq(meetingResponses.userId, webUserId));

    // Встречи: организатор и список приглашённых.
    await tx
      .update(meetings)
      .set({ initiatorId: telegramUserId })
      .where(eq(meetings.initiatorId, webUserId));
    const withInvite = await tx
      .select({ id: meetings.id, invitees: meetings.invitees })
      .from(meetings)
      .where(sql`${meetings.invitees} like ${`%${webUserId}%`}`);
    for (const meeting of withInvite) {
      const ids = inviteeIds(meeting);
      if (!ids.includes(webUserId)) continue;
      const replaced = [...new Set(ids.map((id) => (id === webUserId ? telegramUserId : id)))];
      await tx.update(meetings).set({ invitees: replaced.join(",") }).where(eq(meetings.id, meeting.id));
    }

    // Уведомления, пароль, сессии.
    await tx.update(notices).set({ userId: telegramUserId }).where(eq(notices.userId, webUserId));
    await tx.update(notices).set({ fromUserId: telegramUserId }).where(eq(notices.fromUserId, webUserId));
    if (!(await getCredentials(telegramUserId, tx))) {
      await tx.update(credentials).set({ userId: telegramUserId }).where(eq(credentials.userId, webUserId));
    }
    // Настоящее имя с сайта сохраняется, если в Telegram-аккаунте его ещё не писали.
    if (web.realName && !tg.realName) {
      await tx.update(users).set({ realName: web.realName }).where(eq(users.userId, telegramUserId));
    }
    if (!(await avatarVersion(telegramUserId, tx))) {
      await tx.update(avatars).set({ userId: telegramUserId }).where(eq(avatars.userId, webUserId));
    }
    // Другие устройства сайтового аккаунта — тот же человек: они продолжают работать уже как Telegram-аккаунт.
    await tx.update(webSessions).set({ userId: telegramUserId }).where(eq(webSessions.userId, webUserId));

    // Всё, что не перенесено (дубли расписания, пароль, если он уже был), уйдёт каскадом.
    await tx.delete(users).where(eq(users.userId, webUserId));
    return true;
  });
}

/**
 * Счётчик попыток в окне поверх bot_state.
 *
 * Возвращает, сколько попыток уже было в текущем окне, включая эту. Нужен для
 * ограничения перебора паролей и частоты напоминаний — отдельная таблица ради
 * этого не нужна.
 *
 * Увеличение — одна инструкция INSERT … ON CONFLICT DO UPDATE: строка
 * блокируется на время обновления, поэтому параллельные запросы не могут
 * прочитать один и тот же счётчик и затереть прибавки друг друга. Прежняя
 * версия «прочитать → прибавить → записать» пропускала пачку одновременных
 * попыток входа мимо лимита.
 */
export async function bumpCounter(key: string, windowMs: number, exec?: Exec): Promise<number> {
  const now = Date.now();
  const fresh = { count: 1, since: now };
  // Числа уходят в SQL строками с явным приведением: у «голого» параметра
  // внутри sql-фрагмента нет типа, и postgres.js на нём спотыкается.
  const [row] = await ex(exec)
    .insert(botState)
    .values({ key, data: fresh, updatedAt: new Date(now) })
    .onConflictDoUpdate({
      target: botState.key,
      set: {
        data: sql`case
          when coalesce((${botState.data}->>'since')::bigint, 0) < ${String(now - windowMs)}::bigint
            then ${JSON.stringify(fresh)}::jsonb
          else jsonb_set(
            ${botState.data},
            '{count}',
            to_jsonb(coalesce((${botState.data}->>'count')::int, 0) + 1)
          )
        end`,
        updatedAt: new Date(now),
      },
    })
    .returning({ data: botState.data });
  return Number((row?.data as { count?: number } | undefined)?.count ?? 1);
}

export async function peekCounter(key: string, windowMs: number, exec?: Exec): Promise<number> {
  const current = await getBotState<{ count: number; since: number }>(key, exec);
  if (!current || Date.now() - current.since > windowMs) return 0;
  return current.count;
}

export { ROLE_ADMIN, ROLE_MEMBER, displayName };
