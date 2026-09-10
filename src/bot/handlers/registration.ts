/** Подключение чата и регистрация участников: /setup, /join, /members, /remind, /link. */

import "server-only";

import * as repo from "@/db/repo";
import type { User } from "@/db/schema";
import { t } from "@/i18n";
import { siteUrl } from "@/lib/config";
import {
  TelegramError,
  answerCallbackQuery,
  isGroup,
  keyboard,
  sendMessage,
  type InlineKeyboardMarkup,
  type TgCallbackQuery,
  type TgChat,
  type TgChatMemberUpdated,
  type TgMessage,
} from "../api";
import { botUsername, isChatAdmin, mentionList, resolveLang, syncUser } from "../context";

/** Кнопка deep-link: открывает личку и сразу привязывает человека к чату. */
async function setupKeyboard(chatId: number, lang: string): Promise<InlineKeyboardMarkup> {
  const username = await botUsername();
  return keyboard([
    [{ text: t(lang, "btn_fill_schedule"), url: `https://t.me/${username}?start=c${chatId}` }],
    [{ text: t(lang, "btn_who_filled"), callback_data: "members:show" }],
  ]);
}

/**
 * Персональная ссылка на веб-версию этой группы.
 *
 * Токен выдаётся конкретному человеку и открывает ЕГО расписание — то же
 * самое, что он заполнил в боте. Поэтому шлём только в личку.
 */
export async function cmdLink(message: TgMessage): Promise<void> {
  const from = message.from;
  if (!from) return;

  const lang = await resolveLang(message.chat, from);
  const base = siteUrl();
  if (!base) {
    await sendMessage({ chat_id: message.chat.id, text: t(lang, "web_not_configured") });
    return;
  }

  await syncUser(from);

  let chat: Awaited<ReturnType<typeof repo.getChat>> = null;
  if (isGroup(message.chat)) {
    chat = await repo.upsertChat(message.chat.id, message.chat.title ?? "");
    await repo.addMembership(message.chat.id, from.id);
  } else {
    const chats = await repo.userChats(from.id);
    chat = chats[0] ?? null;
  }
  if (!chat) {
    await sendMessage({ chat_id: message.chat.id, text: t(lang, "avail_no_members") });
    return;
  }

  const slug = await repo.ensureSlug(chat);
  const token = await repo.issueWebSession(from.id);
  const markup = keyboard([
    [{ text: t(lang, "btn_open_web"), url: `${base}/g/${slug}?t=${token}` }],
  ]);

  if (!isGroup(message.chat)) {
    await sendMessage({
      chat_id: message.chat.id,
      text: t(lang, "web_link"),
      parse_mode: "HTML",
      reply_markup: markup,
    });
    return;
  }

  try {
    await sendMessage({
      chat_id: from.id,
      text: t(lang, "web_link"),
      parse_mode: "HTML",
      reply_markup: markup,
    });
    await sendMessage({ chat_id: message.chat.id, text: t(lang, "web_link_sent") });
  } catch (error) {
    // Бот не может написать первым, пока человек не нажал /start.
    if (error instanceof TelegramError && error.isForbidden) {
      await sendMessage({
        chat_id: message.chat.id,
        text: t(lang, "web_link_dm_first"),
        reply_markup: await setupKeyboard(message.chat.id, lang),
      });
      return;
    }
    throw error;
  }
}

export async function cmdSetup(message: TgMessage): Promise<void> {
  const from = message.from;
  if (!from) return;

  if (!isGroup(message.chat)) {
    const lang = await resolveLang(message.chat, from);
    await sendMessage({ chat_id: message.chat.id, text: t(lang, "only_group") });
    return;
  }

  const chat = await repo.upsertChat(message.chat.id, message.chat.title ?? "");
  const lang = chat.lang;
  if (!(await isChatAdmin(message.chat, from))) {
    await sendMessage({ chat_id: message.chat.id, text: t(lang, "only_admin") });
    return;
  }

  await syncUser(from);
  await repo.addMembership(message.chat.id, from.id);

  await sendMessage({
    chat_id: message.chat.id,
    text: t(lang, "setup_done", { chat: message.chat.title ?? "" }),
    parse_mode: "HTML",
    reply_markup: await setupKeyboard(message.chat.id, lang),
  });
}

export async function cmdJoin(message: TgMessage): Promise<void> {
  const from = message.from;
  if (!from) return;

  if (!isGroup(message.chat)) {
    const lang = await resolveLang(message.chat, from);
    await sendMessage({ chat_id: message.chat.id, text: t(lang, "only_group") });
    return;
  }

  const chat = await repo.upsertChat(message.chat.id, message.chat.title ?? "");
  const lang = chat.lang;
  await syncUser(from);
  const isNew = await repo.addMembership(message.chat.id, from.id);

  await sendMessage({
    chat_id: message.chat.id,
    text: t(lang, isNew ? "join_ok" : "join_already", { name: from.first_name ?? "" }),
    parse_mode: "HTML",
    reply_markup: await setupKeyboard(message.chat.id, lang),
  });
}

/** Выйти из списка участников чата — расписание при этом сохраняется. */
export async function cmdLeave(message: TgMessage): Promise<void> {
  const from = message.from;
  if (!from) return;

  if (!isGroup(message.chat)) {
    const lang = await resolveLang(message.chat, from);
    await sendMessage({ chat_id: message.chat.id, text: t(lang, "only_group") });
    return;
  }

  const chat = await repo.getChat(message.chat.id);
  const lang = chat?.lang ?? "ru";
  await repo.removeMembership(message.chat.id, from.id);

  await sendMessage({
    chat_id: message.chat.id,
    text: t(lang, "leave_ok", { name: from.first_name ?? "" }),
    parse_mode: "HTML",
  });
}

async function membersText(chatId: number, lang: string): Promise<string> {
  const people = await repo.chatMembers(chatId);
  if (people.length === 0) return t(lang, "members_empty");

  const marked = await repo.filledIds(people.map((person) => person.userId));
  const filled: User[] = [];
  const missing: User[] = [];
  for (const person of people) {
    (marked.has(person.userId) ? filled : missing).push(person);
  }

  let text = t(lang, "members_title");
  text += t(lang, "members_filled", { count: filled.length, names: mentionList(filled) });
  if (missing.length) {
    text += t(lang, "members_missing", { count: missing.length, names: mentionList(missing) });
  }
  return text;
}

export async function cmdMembers(message: TgMessage): Promise<void> {
  if (!isGroup(message.chat)) {
    const lang = await resolveLang(message.chat, message.from);
    await sendMessage({ chat_id: message.chat.id, text: t(lang, "only_group") });
    return;
  }

  const chat = await repo.upsertChat(message.chat.id, message.chat.title ?? "");
  await sendMessage({
    chat_id: message.chat.id,
    text: await membersText(message.chat.id, chat.lang),
    parse_mode: "HTML",
    reply_markup: await setupKeyboard(message.chat.id, chat.lang),
  });
}

export async function onMembersButton(query: TgCallbackQuery): Promise<void> {
  const message = query.message;
  if (!message) return;
  const chat = await repo.getChat(message.chat.id);
  const lang = chat?.lang ?? "ru";

  await answerCallbackQuery({ callback_query_id: query.id });
  await sendMessage({
    chat_id: message.chat.id,
    text: await membersText(message.chat.id, lang),
    parse_mode: "HTML",
    reply_markup: await setupKeyboard(message.chat.id, lang),
  });
}

/** Один агрегированный пинг вместо N сообщений — бережём лимиты Telegram. */
export async function cmdRemind(message: TgMessage): Promise<void> {
  if (!isGroup(message.chat)) return;

  const chat = await repo.upsertChat(message.chat.id, message.chat.title ?? "");
  const lang = chat.lang;
  if (!(await isChatAdmin(message.chat, message.from))) {
    await sendMessage({ chat_id: message.chat.id, text: t(lang, "only_admin") });
    return;
  }

  const people = await repo.chatMembers(message.chat.id);
  const marked = await repo.filledIds(people.map((person) => person.userId));
  const missing = people.filter((person) => !marked.has(person.userId));

  if (missing.length === 0) {
    await sendMessage({ chat_id: message.chat.id, text: t(lang, "remind_nobody") });
    return;
  }

  await sendMessage({
    chat_id: message.chat.id,
    text: t(lang, "remind_text", { names: mentionList(missing) }),
    parse_mode: "HTML",
    reply_markup: await setupKeyboard(message.chat.id, lang),
  });
}

/** Бота добавили в группу — сразу подсказываем, что делать. */
export async function onMyChatMember(
  update: TgChatMemberUpdated,
  botId: number,
): Promise<void> {
  const member = update.new_chat_member;
  if (!member || member.user.id !== botId) return;
  if (member.status !== "member" && member.status !== "administrator") return;

  const tgChat: TgChat = update.chat;
  if (!isGroup(tgChat)) return;

  const chat = await repo.upsertChat(tgChat.id, tgChat.title ?? "");
  try {
    await sendMessage({
      chat_id: tgChat.id,
      text: t(chat.lang, "setup_done", { chat: tgChat.title ?? "" }),
      parse_mode: "HTML",
      reply_markup: await setupKeyboard(tgChat.id, chat.lang),
    });
  } catch (error) {
    if (!(error instanceof TelegramError && error.isForbidden)) throw error;
  }
}

export { setupKeyboard };
