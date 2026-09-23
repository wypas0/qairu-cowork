/** Подключение чата и участники: /setup, /join, /members, /remind, /link. */

import "server-only";

import * as repo from "@/db/repo";
import type { User } from "@/db/schema";
import { t } from "@/i18n";
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
import { isChatAdmin, mentionList, resolveLang, syncUser } from "../context";
import { groupPath, joinViaBotButton, openGroupButton, sitePage, webAppButton } from "../site";

/**
 * Кнопки под сообщениями бота в группе. «Заполнить расписание» открывает
 * группу сразу в мини-приложении, если оно у бота есть, а иначе — личку с
 * ботом, которая привязывает человека к чату и уже оттуда открывает сайт.
 */
async function setupKeyboard(chatId: number, lang: string): Promise<InlineKeyboardMarkup> {
  return keyboard([
    [await openGroupButton(lang, chatId)],
    [{ text: t(lang, "btn_who_filled"), callback_data: "members:show" }],
  ]);
}

/**
 * /link — открыть группу на сайте.
 *
 * Ссылка приходит в личку кнопкой Mini App: Telegram сам подтверждает, кто
 * открыл сайт, поэтому ни токенов в ссылке, ни пароля не нужно.
 */
export async function cmdLink(message: TgMessage): Promise<void> {
  const from = message.from;
  if (!from) return;

  const lang = await resolveLang(message.chat, from);
  if (!sitePage()) {
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
    chat = chats.length === 1 ? chats[0] : null;
  }

  const path = chat ? groupPath({ slug: await repo.ensureSlug(chat) }) : "/";
  const button = webAppButton(t(lang, chat ? "btn_open_group_site" : "btn_open_site"), path);
  const dm = {
    text: chat ? t(lang, "web_link", { chat: chat.title || "—" }) : t(lang, "web_link_any"),
    parse_mode: "HTML" as const,
    reply_markup: button ? keyboard([[button]]) : undefined,
  };

  if (!isGroup(message.chat)) {
    await sendMessage({ chat_id: message.chat.id, ...dm });
    return;
  }

  try {
    await sendMessage({ chat_id: from.id, ...dm });
    await sendMessage({ chat_id: message.chat.id, text: t(lang, "web_link_sent") });
  } catch (error) {
    // Бот не может написать первым, пока человек не нажал /start.
    if (error instanceof TelegramError && error.isForbidden) {
      await sendMessage({
        chat_id: message.chat.id,
        text: t(lang, "web_link_dm_first"),
        reply_markup: keyboard([[await joinViaBotButton(lang, message.chat.id, "btn_open_bot")]]),
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
