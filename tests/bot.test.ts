/**
 * Сквозные сценарии телеграм-бота.
 *
 * Апдейты прогоняются через настоящий маршрутизатор поверх настоящего Postgres;
 * наружу вместо Bot API стоит заглушка, которая записывает вызовы.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { TgUpdate } from "@/bot/api";
import { startTestDb } from "./support/db";
import { BOT_ID, BOT_USERNAME, installTelegramStub, type TelegramStub } from "./support/telegram";

const GROUP_ID = -1001234567890;
const AMIR = { id: 501, is_bot: false, first_name: "Амир", username: "amir", language_code: "ru" };
const ASEL = { id: 502, is_bot: false, first_name: "Асель", username: "asel", language_code: "ru" };

const GROUP_CHAT = { id: GROUP_ID, type: "supergroup" as const, title: "ИС-21" };
const PRIVATE_AMIR = { id: AMIR.id, type: "private" as const };
const PRIVATE_ASEL = { id: ASEL.id, type: "private" as const };

let stub: TelegramStub;
let updateId = 1;
let messageId = 1;

let handleUpdate: (update: TgUpdate) => Promise<void>;

beforeAll(async () => {
  process.env.BOT_TOKEN = "123456:AAHtestTOKENtestTOKENtestTOKENtestTO";
  process.env.NEXT_PUBLIC_SITE_URL = "https://qairu.example";
  stub = installTelegramStub();
  await startTestDb();
  ({ handleUpdate } = await import("@/bot/router"));
});

beforeEach(() => {
  stub.reset();
  stub.memberStatus = "creator";
  stub.adminIds = [];
  stub.blockedIds = [];
});

function text(chat: typeof GROUP_CHAT | typeof PRIVATE_AMIR, from: typeof AMIR, body: string) {
  return {
    update_id: updateId++,
    message: {
      message_id: messageId++,
      from,
      chat,
      date: Math.floor(Date.now() / 1000),
      text: body,
      entities: body.includes("@")
        ? [{ type: "mention", offset: body.indexOf("@"), length: 5 }]
        : undefined,
    },
  } as TgUpdate;
}

function reply(
  chat: typeof GROUP_CHAT,
  from: typeof AMIR,
  body: string,
  replyToMessageId: number,
) {
  return {
    update_id: updateId++,
    message: {
      message_id: messageId++,
      from,
      chat,
      date: Math.floor(Date.now() / 1000),
      text: body,
      reply_to_message: {
        message_id: replyToMessageId,
        chat,
        date: Math.floor(Date.now() / 1000),
      },
    },
  } as TgUpdate;
}

function callback(chat: typeof GROUP_CHAT, from: typeof AMIR, data: string, msgId = 900) {
  return {
    update_id: updateId++,
    callback_query: {
      id: `cb${updateId}`,
      from,
      data,
      message: {
        message_id: msgId,
        chat,
        date: Math.floor(Date.now() / 1000),
      },
    },
  } as TgUpdate;
}

/** id последнего сообщения, которое бот отправил (Telegram возвращает его в ответе). */
function lastSentMessageId(): number {
  return stub.nextMessageId - 1;
}

describe("подключение чата и регистрация", () => {
  it("/setup доступен только админу", async () => {
    stub.memberStatus = "member";
    await handleUpdate(text(GROUP_CHAT, AMIR, "/setup@qairucoworkbot"));
    expect(stub.lastText()).toContain("администратор");
  });

  it("/setup подключает чат и даёт deep-link кнопку", async () => {
    stub.memberStatus = "creator";
    await handleUpdate(text(GROUP_CHAT, AMIR, "/setup"));

    const call = stub.last("sendMessage")!;
    expect(String(call.payload.text)).toContain("подключён");
    const markup = call.payload.reply_markup as {
      inline_keyboard: { text: string; url?: string }[][];
    };
    expect(markup.inline_keyboard[0][0].url).toBe(
      `https://t.me/${BOT_USERNAME}?start=c${GROUP_ID}`,
    );

    const repo = await import("@/db/repo");
    expect((await repo.getChat(GROUP_ID))?.title).toBe("ИС-21");
    expect(await repo.isMember(GROUP_ID, AMIR.id)).toBe(true);
  });

  it("deep-link /start привязывает человека к чату и ведёт на первый шаг в группе", async () => {
    await handleUpdate(text(PRIVATE_ASEL, ASEL, `/start c${GROUP_ID}`));
    const call = stub.last("sendMessage")!;
    expect(String(call.payload.text)).toContain("Ты в группе");
    const markup = call.payload.reply_markup as { inline_keyboard: { web_app?: { url: string } }[][] };
    // Первый шаг — «как тебя подписать»; оттуда сайт сам решит, нужен ли редактор.
    expect(markup.inline_keyboard[0][0].web_app?.url).toMatch(/^https:\/\/qairu\.example\/g\/[a-z0-9]{8}\/welcome$/);

    const repo = await import("@/db/repo");
    expect(await repo.isMember(GROUP_ID, ASEL.id)).toBe(true);
  });

  it("обычный /start приветствует и открывает сайт как Mini App", async () => {
    await handleUpdate(text(PRIVATE_AMIR, AMIR, "/start"));
    const call = stub.last("sendMessage")!;
    expect(String(call.payload.text)).toContain("Привет, Амир");
    const markup = call.payload.reply_markup as { inline_keyboard: { web_app?: { url: string } }[][] };
    expect(markup.inline_keyboard[0][0].web_app?.url).toBe("https://qairu.example/");
  });

  it("/members показывает, кто заполнил, а кто нет", async () => {
    await handleUpdate(text(GROUP_CHAT, AMIR, "/members"));
    const body = stub.lastText();
    expect(body).toContain("Ещё не заполнили");
    expect(body).toContain(`tg://user?id=${ASEL.id}`);
  });

  it("бота добавили в группу — он сам объясняет, что делать", async () => {
    await handleUpdate({
      update_id: updateId++,
      my_chat_member: {
        chat: GROUP_CHAT,
        from: AMIR,
        old_chat_member: { user: { id: BOT_ID }, status: "left" },
        new_chat_member: { user: { id: BOT_ID }, status: "member" },
      },
    } as TgUpdate);
    expect(stub.lastText()).toContain("подключён");
  });
});

describe("личка: расписание переехало на сайт", () => {
  beforeAll(async () => {
    // Расписание теперь заполняют на сайте — здесь кладём его прямо в базу.
    const repo = await import("@/db/repo");
    await repo.replaceWeeklySlots(
      AMIR.id,
      [0, 1, 2, 3, 4, 5, 6],
      [
        { weekday: 0, start: 540, end: 630, label: "Матан" },
        { weekday: 1, start: 780, end: 870, label: "История" },
      ],
      "web",
    );
    await repo.replaceWeeklySlots(
      ASEL.id,
      [0, 1, 2, 3, 4, 5, 6],
      [
        { weekday: 0, start: 540, end: 630 },
        { weekday: 0, start: 780, end: 870 },
      ],
      "web",
    );
  });

  it("свободный текст не сохраняется, а ведёт на сайт", async () => {
    await handleUpdate(text(PRIVATE_AMIR, AMIR, "Ср 10:00-11:00 Физика"));
    const call = stub.last("sendMessage")!;
    expect(String(call.payload.text)).toContain("на сайте");
    const markup = call.payload.reply_markup as { inline_keyboard: { web_app?: { url: string } }[][] };
    expect(markup.inline_keyboard[0][0].web_app?.url).toMatch(/^https:\/\/qairu\.example\//);

    const repo = await import("@/db/repo");
    expect((await repo.getSlots(AMIR.id)).map((slot) => slot.weekday)).toEqual([0, 1]);
  });

  it("старые команды расписания отвечают кнопкой на сайт", async () => {
    for (const command of ["/schedule", "/wizard", "/myschedule", "/busy", "/clear", "/free"]) {
      stub.reset();
      await handleUpdate(text(PRIVATE_AMIR, AMIR, command));
      expect(stub.lastText()).toContain("на сайте");
    }
    const repo = await import("@/db/repo");
    expect(await repo.getSlots(AMIR.id)).toHaveLength(2);
  });

  it("кнопки мастера из старых сообщений объясняют, что всё на сайте", async () => {
    await handleUpdate(callback(PRIVATE_AMIR as never, AMIR, "sch:ok"));
    const answer = stub.last("answerCallbackQuery")!;
    expect(String(answer.payload.text)).toContain("на сайте");
    expect(answer.payload.show_alert).toBe(true);
  });

  it("/help в личке — про уведомления и три команды", async () => {
    await handleUpdate(text(PRIVATE_AMIR, AMIR, "/help"));
    const body = stub.lastText();
    expect(body).toContain("Присылаю уведомления");
    expect(body).not.toContain("/schedule");
  });
});

describe("/availability", () => {
  it("в группе показывает общие окна", async () => {
    await handleUpdate(text(GROUP_CHAT, AMIR, "/availability"));
    const body = stub.lastText();
    expect(body).toContain("Общие свободные окна");
    expect(body).toContain("Ищу с 08:00 до 22:00");
  });

  it("понимает минимальную длительность", async () => {
    await handleUpdate(text(GROUP_CHAT, AMIR, "/free 90"));
    expect(stub.lastText()).toContain("окна от 90 мин");
  });

  it("кворум в процентах смягчает требования и называет отсутствующих", async () => {
    await handleUpdate(text(GROUP_CHAT, AMIR, "/availability 50%"));
    const body = stub.lastText();
    expect(body).toContain("свободны хотя бы 1 из 2");
  });

  it("в новом чате подключает вызвавшего сам, не требуя /setup", async () => {
    const other = { id: -100999, type: "supergroup" as const, title: "Другой" };
    await handleUpdate(text(other as never, AMIR, "/free"));
    expect(stub.lastText()).toContain("все участники чата (1)");

    const repo = await import("@/db/repo");
    expect(await repo.isMember(-100999, AMIR.id)).toBe(true);
  });

  it("в личке ведёт на сайт", async () => {
    const loner = { ...AMIR, id: 777001, username: "loner", first_name: "Одиночка" };
    await handleUpdate(text({ id: loner.id, type: "private" } as never, loner, "/availability"));
    expect(stub.lastText()).toContain("на сайте");
  });
});

describe("/meeting", () => {
  let placePromptId = 0;
  let timePromptId = 0;
  let goalPromptId = 0;

  it("шаг 1 — спрашивает место", async () => {
    await handleUpdate(text(GROUP_CHAT, AMIR, "/meeting"));
    const call = stub.last("sendMessage")!;
    expect(String(call.payload.text)).toContain("Где встречаемся");
    expect(call.payload.reply_markup).toEqual({ force_reply: true, selective: true });
    placePromptId = lastSentMessageId();
  });

  it("чужой ответ на подсказку игнорируется", async () => {
    stub.reset();
    await handleUpdate(reply(GROUP_CHAT, ASEL, "Столовая", placePromptId));
    // Асель не организатор: её ответ не двигает мастер и не создаёт сообщений.
    expect(stub.of("sendMessage")).toHaveLength(0);
  });

  it("шаг 2 — предлагает общие окна кнопками", async () => {
    await handleUpdate(reply(GROUP_CHAT, AMIR, "Библиотека, 3 этаж", placePromptId));
    const call = stub.last("sendMessage")!;
    expect(String(call.payload.text)).toContain("когда?");
    const markup = call.payload.reply_markup as {
      inline_keyboard: { text: string; callback_data: string }[][];
    };
    expect(markup.inline_keyboard.length).toBeGreaterThan(1);
    expect(markup.inline_keyboard[0][0].callback_data).toBe("mtg:slot:0");
    expect(markup.inline_keyboard.at(-1)![0].callback_data).toBe("mtg:manual");
    timePromptId = lastSentMessageId();
  });

  it("шаг 3 — выбор окна ведёт к вопросу о цели", async () => {
    await handleUpdate(callback(GROUP_CHAT, AMIR, "mtg:slot:0", timePromptId));
    expect(stub.lastText("editMessageText")).toContain("🕒");
    expect(stub.lastText()).toContain("цель встречи");
    goalPromptId = lastSentMessageId();
  });

  it("карточка встречи публикуется с кнопками голосования", async () => {
    await handleUpdate(reply(GROUP_CHAT, AMIR, "Разбор задач по матанализу", goalPromptId));
    const call = stub.last("sendMessage")!;
    const body = String(call.payload.text);
    expect(body).toContain("Библиотека, 3 этаж");
    expect(body).toContain("Разбор задач по матанализу");
    expect(body).toContain(`tg://user?id=${AMIR.id}`);

    const markup = call.payload.reply_markup as {
      inline_keyboard: { text: string; callback_data: string }[][];
    };
    const actions = markup.inline_keyboard.flat().map((b) => b.callback_data);
    expect(actions.some((data) => data.endsWith(":yes"))).toBe(true);
    expect(actions.some((data) => data.startsWith("card:ics:"))).toBe(true);

    const repo = await import("@/db/repo");
    const meetings = await repo.chatMeetings(GROUP_ID);
    expect(meetings).toHaveLength(1);
    // Время выбрано кнопкой, значит известен точный момент — напоминание возможно.
    expect(meetings[0].whenStart).toBeInstanceOf(Date);
    expect(meetings[0].chatMessageId).toBeTruthy();
    // Кнопка — целое свободное окно, а встреча длится как на сайте по умолчанию,
    // но не дольше окна.
    const chat = (await repo.getChat(GROUP_ID))!;
    const [, h1, m1, h2, m2] = /(\d{1,2}):(\d{2})\s*[–—-]\s*(\d{1,2}):(\d{2})/.exec(meetings[0].whenText)!.map(Number);
    const usual = chat.minSlotMin >= 15 && chat.minSlotMin <= 720 ? chat.minSlotMin : 60;
    expect(meetings[0].durationMin).toBe(Math.min(usual, h2 * 60 + m2 - (h1 * 60 + m1)));
  });

  it("голос учитывается и карточка перерисовывается", async () => {
    const repo = await import("@/db/repo");
    const meeting = (await repo.chatMeetings(GROUP_ID))[0];

    stub.reset();
    await handleUpdate(callback(GROUP_CHAT, ASEL, `vote:${meeting.id}:yes`));
    expect(String(stub.last("answerCallbackQuery")?.payload.text)).toContain("Ответ сохранён");
    expect(stub.lastText("editMessageText")).toContain("✅ Придут (1)");

    // Организатор получает ответ в личку.
    const dm = stub.of("sendMessage").find((call) => call.payload.chat_id === AMIR.id)!;
    expect(String(dm.payload.text)).toContain("Асель придёт на встречу");
    expect(String(dm.payload.text)).toContain("Согласились 1 из");

    const answers = await repo.meetingResponsesFor(meeting.id);
    expect(answers.map((row) => row.userId)).toEqual([ASEL.id]);
  });

  it("ответ «может быть» попадает в карточку и в личку организатору", async () => {
    const repo = await import("@/db/repo");
    const meeting = (await repo.chatMeetings(GROUP_ID))[0];

    stub.reset();
    await handleUpdate(callback(GROUP_CHAT, ASEL, `vote:${meeting.id}:maybe`));
    const card = stub.lastText("editMessageText");
    expect(card).toContain("🤔 Может быть (1)");
    expect(card).toContain("✅ Придут (0)");

    const dm = stub.of("sendMessage").find((call) => call.payload.chat_id === AMIR.id)!;
    expect(String(dm.payload.text)).toContain("пока не уверен");

    const answers = await repo.meetingResponsesFor(meeting.id);
    expect(answers.find((row) => row.userId === ASEL.id)?.answer).toBe("maybe");

    // Возвращаем «да», чтобы следующие проверки шли от прежнего состояния.
    await handleUpdate(callback(GROUP_CHAT, ASEL, `vote:${meeting.id}:yes`));
  });

  it("посторонний проголосовать не может", async () => {
    const repo = await import("@/db/repo");
    const meeting = (await repo.chatMeetings(GROUP_ID))[0];
    const stranger = { ...AMIR, id: 999999, username: "stranger", first_name: "Чужак" };

    stub.reset();
    await handleUpdate(callback(GROUP_CHAT, stranger, `vote:${meeting.id}:yes`));
    const answer = stub.last("answerCallbackQuery")!;
    expect(String(answer.payload.text)).toContain("нет среди приглашённых");
    expect(answer.payload.show_alert).toBe(true);
    expect(stub.of("editMessageText")).toHaveLength(0);
  });

  it("«предложить изменения» дописывает комментарий в карточку", async () => {
    const repo = await import("@/db/repo");
    const meeting = (await repo.chatMeetings(GROUP_ID))[0];

    await handleUpdate(callback(GROUP_CHAT, ASEL, `vote:${meeting.id}:change`));
    const prompt = stub.last("sendMessage")!;
    expect(String(prompt.payload.text)).toContain("Что предлагаешь изменить");
    const promptId = lastSentMessageId();

    stub.reset();
    await handleUpdate(reply(GROUP_CHAT, ASEL, "лучше в 16:00", promptId));
    expect(stub.lastText("editMessageText")).toContain("лучше в 16:00");
    expect(stub.lastText()).toContain("Предложение добавлено");
    const dm = stub.of("sendMessage").find((call) => call.payload.chat_id === AMIR.id)!;
    expect(String(dm.payload.text)).toContain("предлагает изменить встречу");

    const answers = await repo.meetingResponsesFor(meeting.id);
    expect(answers[0].answer).toBe("change");
    expect(answers[0].comment).toBe("лучше в 16:00");
  });

  it("отменить встречу может только организатор или администратор", async () => {
    const repo = await import("@/db/repo");
    const meeting = (await repo.chatMeetings(GROUP_ID))[0];

    await handleUpdate(callback(GROUP_CHAT, ASEL, `card:cancel:${meeting.id}`));
    expect(String(stub.last("answerCallbackQuery")?.payload.text)).toContain("организатор или администратор");
    expect((await repo.getMeeting(meeting.id))?.status).toBe("open");

    await handleUpdate(callback(GROUP_CHAT, AMIR, `card:cancel:${meeting.id}`));
    expect((await repo.getMeeting(meeting.id))?.status).toBe("cancelled");
    expect(stub.lastText("editMessageText")).toContain("Встреча отменена");
  });

  it("кнопка календаря отдаёт .ics файлом", async () => {
    const repo = await import("@/db/repo");
    const meeting = (await repo.chatMeetings(GROUP_ID))[0];
    await repo.updateMeeting(meeting.id, { status: "open" });

    stub.reset();
    await handleUpdate(callback(GROUP_CHAT, AMIR, `card:ics:${meeting.id}`));
    const document = stub.last("sendDocument")!;
    expect(String(document.payload.document)).toMatch(/^<blob \d+b>$/);
    expect(String(document.payload.caption)).toContain("календарь");
  });
});

describe("настройки и язык", () => {
  it("/settings и /leave в группе переехали на сайт", async () => {
    const repo = await import("@/db/repo");
    for (const command of ["/settings hours 9:00 21:00", "/leave"]) {
      stub.reset();
      await handleUpdate(text(GROUP_CHAT, ASEL, command));
      const call = stub.last("sendMessage")!;
      expect(String(call.payload.text)).toContain("переехала на сайт");
      const markup = call.payload.reply_markup as { inline_keyboard: { url?: string }[][] };
      expect(markup.inline_keyboard[0][0].url).toMatch(/^https:\/\/qairu\.example\/g\/[a-z0-9]{8}$/);
    }
    expect((await repo.getChat(GROUP_ID))?.dayStartMin).toBe(480);
    expect(await repo.isMember(GROUP_ID, ASEL.id)).toBe(true);
  });

  it("/lang переключает язык чата", async () => {
    stub.memberStatus = "creator";
    await handleUpdate(text(GROUP_CHAT, AMIR, "/lang"));
    expect(stub.lastText()).toContain("Выбери язык");

    await handleUpdate(callback(GROUP_CHAT, AMIR, "lang:en"));
    expect(stub.lastText("editMessageText")).toContain("Interface language: English");

    const repo = await import("@/db/repo");
    expect((await repo.getChat(GROUP_ID))?.lang).toBe("en");
    await repo.updateChat(GROUP_ID, { lang: "ru" });
  });

  it("/link присылает в личку кнопку Mini App — без токена в ссылке", async () => {
    stub.reset();
    await handleUpdate(text(GROUP_CHAT, AMIR, "/link"));

    const dm = stub.of("sendMessage").find((call) => call.payload.chat_id === AMIR.id)!;
    const markup = dm.payload.reply_markup as { inline_keyboard: { web_app?: { url: string } }[][] };
    expect(markup.inline_keyboard[0][0].web_app?.url).toMatch(/^https:\/\/qairu\.example\/g\/[a-z0-9]{8}$/);
    expect(stub.lastText()).toContain("Отправил ссылку");
  });
});

describe("код группы в личке", () => {
  it("присланный код добавляет человека в группу", async () => {
    const repo = await import("@/db/repo");
    const chat = (await repo.getChat(GROUP_ID))!;
    const slug = await repo.ensureSlug(chat);
    const stranger = { id: 777001, is_bot: false, first_name: "Новенький", username: "new", language_code: "ru" };

    stub.reset();
    // Код диктуют вслух, поэтому принимаем его как угодно: с пробелом и заглавными.
    const spaced = `${slug.slice(0, 4).toUpperCase()} ${slug.slice(4).toUpperCase()}`;
    await handleUpdate(text({ id: stranger.id, type: "private" as const }, stranger, spaced));

    expect(await repo.isMember(GROUP_ID, stranger.id)).toBe(true);
    expect(stub.lastText()).toContain("Ты в группе");
  });

  it("случайный текст остаётся приглашением открыть сайт", async () => {
    const repo = await import("@/db/repo");
    const stranger = { id: 777002, is_bot: false, first_name: "Мимо", username: "mimo", language_code: "ru" };

    stub.reset();
    await handleUpdate(text({ id: stranger.id, type: "private" as const }, stranger, "qwertyui"));

    expect(await repo.isMember(GROUP_ID, stranger.id)).toBe(false);
    expect(stub.lastText()).toContain("на сайте");
  });
});

describe("повторяющиеся встречи", () => {
  it("напоминание приходит перед каждым повтором, но один раз", async () => {
    const repo = await import("@/db/repo");
    const { sendDueReminders } = await import("@/bot/handlers/meeting");
    const { addDays, todayIn } = await import("@/core/timeutils");

    await repo.updateChat(GROUP_ID, { reminderMin: 30 });
    // Серия началась неделю назад; следующий повтор — через 20 минут.
    // Встречи — с точностью до минуты, как и выбор времени на сайте.
    const nextStart = new Date(Math.floor((Date.now() + 20 * 60_000) / 60_000) * 60_000);
    const first = new Date(nextStart.getTime() - 7 * 24 * 60 * 60 * 1000);
    const meeting = await repo.createMeeting({
      chatId: GROUP_ID,
      initiatorId: AMIR.id,
      place: "Аудитория 305",
      whenText: "по средам",
      goal: "Консультация",
      invitees: [AMIR.id, ASEL.id],
      whenStart: first,
      repeatUntil: addDays(todayIn("Asia/Almaty"), 60),
    });

    stub.reset();
    const firstRun = await sendDueReminders();
    expect(firstRun).toBeGreaterThanOrEqual(1);
    expect(stub.lastText()).toContain("Консультация");

    const saved = await repo.getMeeting(meeting.id);
    expect(saved!.remindedStart?.getTime()).toBe(nextStart.getTime());
    // Флаг разовой встречи серия не трогает — иначе следующий повтор остался бы без напоминания.
    expect(saved!.reminderSent).toBe(false);

    // Повторный запуск cron по тому же повтору ничего не шлёт.
    stub.reset();
    await sendDueReminders();
    expect(stub.of("sendMessage").some((call) => String(call.payload.text).includes("Консультация"))).toBe(false);

    await repo.updateMeeting(meeting.id, { status: "cancelled" });
  });
});

describe("напоминания", () => {
  it("уходят один раз и зовут тех, кто согласился", async () => {
    const repo = await import("@/db/repo");
    const { sendDueReminders } = await import("@/bot/handlers/meeting");

    await repo.updateChat(GROUP_ID, { reminderMin: 30 });
    const start = new Date(Date.now() + 20 * 60_000);
    const meeting = await repo.createMeeting({
      chatId: GROUP_ID,
      initiatorId: AMIR.id,
      place: "Библиотека",
      whenText: "скоро",
      goal: "Разбор задач",
      invitees: [AMIR.id, ASEL.id],
      whenStart: start,
    });
    await repo.setResponse({ meetingId: meeting.id, userId: ASEL.id, answer: "yes" });

    stub.reset();
    expect(await sendDueReminders()).toBe(1);
    const body = stub.lastText();
    expect(body).toContain("Через 30 мин встреча");
    expect(body).toContain(`tg://user?id=${ASEL.id}`);
    expect(body).not.toContain(`tg://user?id=${AMIR.id}`);

    // Повторный запуск cron не должен слать то же самое ещё раз.
    stub.reset();
    expect(await sendDueReminders()).toBe(0);
    expect(stub.of("sendMessage")).toHaveLength(0);
  });

  it("в группе с сайта напоминание приходит каждому в личку", async () => {
    const repo = await import("@/db/repo");
    const { sendDueReminders } = await import("@/bot/handlers/meeting");

    const chat = await repo.createWebChat({ title: "Проект", tz: "Asia/Almaty", lang: "ru" });
    await repo.updateChat(chat.chatId, { reminderMin: 30 });
    await repo.addMembership(chat.chatId, AMIR.id);
    await repo.addMembership(chat.chatId, ASEL.id);
    await repo.createMeeting({
      chatId: chat.chatId,
      initiatorId: AMIR.id,
      place: "Коворкинг",
      whenText: "сегодня · 15:00–16:30",
      goal: "Созвон по проекту",
      invitees: [AMIR.id, ASEL.id],
      whenStart: new Date(Date.now() + 15 * 60_000),
    });

    stub.reset();
    expect(await sendDueReminders()).toBe(1);
    const targets = stub.of("sendMessage").map((call) => call.payload.chat_id);
    expect(targets.sort()).toEqual([AMIR.id, ASEL.id].sort());
    expect(stub.lastText()).toContain("Через 30 мин встреча");
    expect(stub.lastText()).toContain("Созвон по проекту");
  });
});

describe("устойчивость", () => {
  it("незнакомая команда не уезжает в парсер расписания", async () => {
    stub.reset();
    await handleUpdate(text(PRIVATE_AMIR, AMIR, "/nosuchcommand"));
    expect(stub.of("sendMessage")).toHaveLength(0);
  });

  it("сообщения от других ботов игнорируются", async () => {
    stub.reset();
    await handleUpdate(
      text(GROUP_CHAT, { ...AMIR, is_bot: true } as typeof AMIR, "/availability"),
    );
    expect(stub.of("sendMessage")).toHaveLength(0);
  });

  it("команда с @упоминанием бота разбирается так же", async () => {
    stub.reset();
    await handleUpdate(text(GROUP_CHAT, AMIR, `/help@${BOT_USERNAME}`));
    expect(stub.lastText()).toContain("QairuCowork в чате группы");
  });
});
