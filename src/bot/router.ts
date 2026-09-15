/**
 * Маршрутизация апдейтов.
 *
 * Бот в первую очередь рассылает: напоминания заполнить расписание,
 * приглашения на встречи, ответы на них. Команд у него немного — в личке
 * только вход и язык, в группах то, что удобно сделать прямо в чате.
 * Всё остальное (расписание, окна, настройки) — на сайте, куда ведут кнопки.
 *
 * Порядок: команды, затем ответы на ForceReply-подсказки (мастер встречи и
 * «предложить изменения»), и только потом свободный текст в личке.
 */

import "server-only";

import { getMe, isPrivate, type TgUpdate } from "./api";
import { parseCommand } from "./context";
import * as availability from "./handlers/availability";
import * as common from "./handlers/common";
import * as meeting from "./handlers/meeting";
import * as registration from "./handlers/registration";
import * as weblogin from "./handlers/weblogin";

export const PRIVATE_COMMANDS = [
  { command: "start", description: "Открыть QairuCowork" },
  { command: "lang", description: "Язык / Тіл / Language" },
  { command: "help", description: "Что умеет бот" },
];

export const GROUP_COMMANDS = [
  { command: "setup", description: "Подключить чат (админ)" },
  { command: "join", description: "Добавить себя в участники" },
  { command: "members", description: "Кто заполнил расписание" },
  { command: "free", description: "Общие свободные окна" },
  { command: "meeting", description: "Назначить встречу" },
  { command: "remind", description: "Напомнить незаполнившим (админ)" },
  { command: "link", description: "Открыть группу на сайте" },
  { command: "lang", description: "Язык / Тіл / Language" },
  { command: "help", description: "Что умеет бот" },
];

/** Команды, переехавшие на сайт: на них бот отвечает кнопкой туда. */
const MOVED_TO_SITE = new Set([
  "schedule",
  "import",
  "wizard",
  "myschedule",
  "busy",
  "clear",
  "settings",
  "leave",
]);

let cachedBotId: number | null = null;

async function botId(): Promise<number> {
  if (cachedBotId !== null) return cachedBotId;
  cachedBotId = (await getMe()).id;
  return cachedBotId;
}

export async function handleUpdate(update: TgUpdate): Promise<void> {
  if (update.my_chat_member) {
    await registration.onMyChatMember(update.my_chat_member, await botId());
    return;
  }

  if (update.callback_query) {
    await handleCallback(update.callback_query);
    return;
  }

  const message = update.message;
  if (!message || !message.from || message.from.is_bot) return;

  const text = message.text ?? "";

  if (text.startsWith("/")) {
    const parsed = parseCommand(text);
    if (parsed) {
      await handleCommand(parsed.command, parsed.args, message);
      return;
    }
  }

  // Ответы на ForceReply идут раньше свободного текста.
  if (message.reply_to_message) {
    if (await meeting.onChangeReply(message)) return;
    if (await meeting.onDraftReply(message)) return;
  }

  // Расписание в боте больше не принимается — подсказываем, где его заполнить.
  if (isPrivate(message.chat) && text.trim()) await common.cmdMovedToSite(message);
}

async function handleCommand(
  command: string,
  args: string[],
  message: Parameters<typeof common.cmdHelp>[0],
): Promise<void> {
  const privateChat = isPrivate(message.chat);

  if (MOVED_TO_SITE.has(command)) {
    await common.cmdMovedToSite(message);
    return;
  }

  switch (command) {
    case "start":
      if (privateChat) await common.cmdStart(message, args);
      return;
    case "help":
      await common.cmdHelp(message);
      return;
    case "lang":
      await common.cmdLang(message);
      return;
    case "cancel":
      await common.cmdCancel(message);
      return;

    case "setup":
      await registration.cmdSetup(message);
      return;
    case "join":
      await registration.cmdJoin(message);
      return;
    case "members":
      await registration.cmdMembers(message);
      return;
    case "remind":
      await registration.cmdRemind(message);
      return;
    case "link":
    case "web":
      await registration.cmdLink(message);
      return;

    case "availability":
    case "free":
      if (privateChat) await common.cmdMovedToSite(message);
      else await availability.cmdAvailability(message, args);
      return;

    case "meeting":
      await meeting.cmdMeeting(message);
      return;

    default:
      return;
  }
}

async function handleCallback(query: NonNullable<TgUpdate["callback_query"]>): Promise<void> {
  const data = query.data ?? "";
  if (data.startsWith("lang:")) return common.onLangChoice(query);
  if (data === "members:show") return registration.onMembersButton(query);
  if (data.startsWith("mtg:")) return meeting.onTimeButton(query);
  if (data.startsWith("vote:")) return meeting.onVote(query);
  if (data.startsWith("card:")) return meeting.onCardButton(query);
  if (weblogin.isWebLoginCallback(data)) return weblogin.onWebLoginButton(query);
  // Кнопки мастера расписания и выбора чата из старых сообщений.
  if (/^(sch|wiz|clr|avl):/.test(data)) return common.onRetiredButton(query);
}
