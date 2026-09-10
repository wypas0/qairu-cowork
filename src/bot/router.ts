/**
 * Маршрутизация апдейтов.
 *
 * Порядок повторяет регистрацию хендлеров в python-telegram-bot: сначала
 * команды, затем ответы на ForceReply-подсказки (мастер встречи и «предложить
 * изменения»), и только потом свободный текст в личке — он ловит всё подряд и
 * должен быть последним.
 */

import "server-only";

import { getMe, isPrivate, type TgUpdate } from "./api";
import { clearPrivateState, getPrivateState, parseCommand } from "./context";
import * as availability from "./handlers/availability";
import * as common from "./handlers/common";
import * as meeting from "./handlers/meeting";
import * as registration from "./handlers/registration";
import * as schedule from "./handlers/schedule";

export const PRIVATE_COMMANDS = [
  { command: "start", description: "Начать / Бастау / Start" },
  { command: "schedule", description: "Заполнить расписание" },
  { command: "wizard", description: "Мастер по дням" },
  { command: "myschedule", description: "Моё расписание" },
  { command: "busy", description: "Занятость на дату или период" },
  { command: "availability", description: "Общие окна" },
  { command: "clear", description: "Очистить расписание" },
  { command: "lang", description: "Язык / Тіл / Language" },
  { command: "help", description: "Помощь" },
];

export const GROUP_COMMANDS = [
  { command: "setup", description: "Подключить чат" },
  { command: "join", description: "Присоединиться" },
  { command: "availability", description: "Общие свободные окна" },
  { command: "meeting", description: "Создать встречу" },
  { command: "free", description: "То же, что /availability" },
  { command: "members", description: "Кто заполнил расписание" },
  { command: "link", description: "Ссылка на веб-версию" },
  { command: "leave", description: "Выйти из списка участников" },
  { command: "remind", description: "Напомнить незаполнившим" },
  { command: "settings", description: "Настройки чата" },
  { command: "lang", description: "Язык / Тіл / Language" },
  { command: "help", description: "Помощь" },
];

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

  // Ответы на ForceReply идут раньше свободного текста: иначе мастер встречи
  // перехватывался бы импортом расписания.
  if (message.reply_to_message) {
    if (await meeting.onChangeReply(message)) return;
    if (await meeting.onDraftReply(message)) return;
  }

  if (!isPrivate(message.chat) || !text.trim()) return;

  const state = await getPrivateState(message.from.id);
  if (state?.mode === "wizard") {
    await schedule.onWizardText(message, state.weekday);
    return;
  }
  if (state?.mode === "busy") {
    await schedule.onBusyText(message);
    return;
  }
  await schedule.onScheduleText(message);
}

async function handleCommand(
  command: string,
  args: string[],
  message: Parameters<typeof common.cmdHelp>[0],
): Promise<void> {
  const privateChat = isPrivate(message.chat);

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
    case "settings":
      await common.cmdSettings(message, args);
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
    case "leave":
      await registration.cmdLeave(message);
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
      await availability.cmdAvailability(message, args);
      return;

    case "meeting":
      await meeting.cmdMeeting(message);
      return;

    case "schedule":
    case "import":
      if (privateChat) await schedule.cmdSchedule(message);
      return;
    case "wizard":
      if (privateChat) await schedule.cmdWizard(message);
      return;
    case "myschedule":
      if (privateChat) await schedule.cmdMySchedule(message);
      return;
    case "clear":
      if (privateChat) await schedule.cmdClear(message);
      return;
    case "busy":
      if (privateChat) await schedule.cmdBusy(message);
      return;

    default:
      // Незнакомая команда в личке не должна уехать в парсер расписания.
      if (privateChat && message.from) await clearPrivateState(message.from.id);
      return;
  }
}

async function handleCallback(query: NonNullable<TgUpdate["callback_query"]>): Promise<void> {
  const data = query.data ?? "";
  if (data.startsWith("lang:")) return common.onLangChoice(query);
  if (data === "members:show") return registration.onMembersButton(query);
  if (data.startsWith("avl:")) return availability.onChatChoice(query);
  if (data.startsWith("sch:")) return schedule.onScheduleConfirm(query);
  if (data.startsWith("wiz:")) return schedule.onWizardDay(query);
  if (data.startsWith("clr:")) return schedule.onClearChoice(query);
  if (data.startsWith("mtg:")) return meeting.onTimeButton(query);
  if (data.startsWith("vote:")) return meeting.onVote(query);
  if (data.startsWith("card:")) return meeting.onCardButton(query);
}
