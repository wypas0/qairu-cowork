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

  it("deep-link /start привязывает человека к чату", async () => {
    await handleUpdate(text(PRIVATE_ASEL, ASEL, `/start c${GROUP_ID}`));
    expect(stub.lastText()).toContain("присоединился к чату");

    const repo = await import("@/db/repo");
    expect(await repo.isMember(GROUP_ID, ASEL.id)).toBe(true);
  });

  it("обычный /start приветствует без привязки", async () => {
    await handleUpdate(text(PRIVATE_AMIR, AMIR, "/start"));
    expect(stub.lastText()).toContain("Привет, Амир");
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

describe("ввод расписания в личке", () => {
  it("свободный текст разбирается и ждёт подтверждения", async () => {
    await handleUpdate(text(PRIVATE_AMIR, AMIR, "Пн 9:00-10:30 Матан\nВт 13:00-14:30 История"));

    const call = stub.last("sendMessage")!;
    expect(String(call.payload.text)).toContain("Я так понял твоё расписание");
    expect(String(call.payload.text)).toContain("09:00–10:30");
    const markup = call.payload.reply_markup as {
      inline_keyboard: { callback_data: string }[][];
    };
    expect(markup.inline_keyboard[0].map((b) => b.callback_data)).toEqual(["sch:ok", "sch:retry"]);

    // Ничего не сохраняется молча — до подтверждения расписания нет.
    const repo = await import("@/db/repo");
    expect(await repo.getSlots(AMIR.id)).toEqual([]);
  });

  it("подтверждение сохраняет расписание", async () => {
    await handleUpdate(callback(PRIVATE_AMIR as never, AMIR, "sch:ok"));
    expect(stub.lastText("editMessageText")).toContain("Расписание сохранено");

    const repo = await import("@/db/repo");
    const slots = await repo.getSlots(AMIR.id);
    expect(slots.map((s) => [s.weekday, s.startMin, s.endMin])).toEqual([
      [0, 540, 630],
      [1, 780, 870],
    ]);
    expect(await repo.isFilled(AMIR.id)).toBe(true);
  });

  it("мастер по дням заполняет один день за раз", async () => {
    await handleUpdate(text(PRIVATE_ASEL, ASEL, "/wizard"));
    expect(stub.lastText()).toContain("Выбери день");

    await handleUpdate(callback(PRIVATE_ASEL as never, ASEL, "wiz:day:0"));
    expect(stub.lastText("editMessageText")).toContain("Понедельник");

    await handleUpdate(text(PRIVATE_ASEL, ASEL, "9:00-10:30, 13:00-14:30"));
    expect(stub.of("sendMessage").some((c) => String(c.payload.text).includes("09:00–10:30"))).toBe(
      true,
    );

    await handleUpdate(callback(PRIVATE_ASEL as never, ASEL, "wiz:done"));
    const repo = await import("@/db/repo");
    expect(await repo.isFilled(ASEL.id)).toBe(true);
    expect((await repo.getSlots(ASEL.id)).map((s) => [s.weekday, s.startMin])).toEqual([
      [0, 540],
      [0, 780],
    ]);
  });

  it("/myschedule показывает сохранённое", async () => {
    await handleUpdate(text(PRIVATE_AMIR, AMIR, "/myschedule"));
    const body = stub.lastText();
    expect(body).toContain("Понедельник");
    expect(body).toContain("09:00–10:30");
    expect(body).toContain("Матан");
  });

  it("/busy записывает разовую занятость на диапазон дат", async () => {
    await handleUpdate(text(PRIVATE_AMIR, AMIR, "/busy"));
    expect(stub.lastText()).toContain("Пришли разовую занятость");

    await handleUpdate(text(PRIVATE_AMIR, AMIR, "15.09-20.09 сессия"));
    expect(stub.lastText()).toContain("Записал");

    const repo = await import("@/db/repo");
    const ranges = (await repo.getSlots(AMIR.id)).filter((slot) => slot.dateFrom !== null);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].kind).toBe("exam");
    expect([ranges[0].dateFrom, ranges[0].dateTo]).toEqual(["2026-09-15", "2026-09-20"]);
    // Без времени сессия занимает сутки целиком, а не 15:09–20:09:
    // даты вырезаются из текста до поиска диапазонов времени.
    expect([ranges[0].startMin, ranges[0].endMin]).toEqual([0, 1440]);
    await repo.deleteDatedSlots(AMIR.id);
  });

  it("/busy с явным временем берёт время, а не цифры даты", async () => {
    await handleUpdate(text(PRIVATE_AMIR, AMIR, "/busy"));
    await handleUpdate(text(PRIVATE_AMIR, AMIR, "15.09-20.09 9:00-14:00 практика"));

    const repo = await import("@/db/repo");
    const ranges = (await repo.getSlots(AMIR.id)).filter((slot) => slot.dateFrom !== null);
    expect(ranges).toHaveLength(1);
    expect([ranges[0].startMin, ranges[0].endMin]).toEqual([540, 840]);
    expect(ranges[0].label).toBe("практика");
    await repo.deleteDatedSlots(AMIR.id);
  });

  it("/busy на одну дату с временем и меткой", async () => {
    await handleUpdate(text(PRIVATE_AMIR, AMIR, "/busy"));
    await handleUpdate(text(PRIVATE_AMIR, AMIR, "12.09 14:00-16:00 экзамен"));

    const repo = await import("@/db/repo");
    const dated = (await repo.getSlots(AMIR.id)).filter((slot) => slot.specificDate !== null);
    expect(dated).toHaveLength(1);
    expect([dated[0].startMin, dated[0].endMin]).toEqual([840, 960]);
    expect(dated[0].kind).toBe("exam");
    expect(dated[0].label).toBe("экзамен");
  });

  it("/busy «весь день» без времени занимает сутки", async () => {
    const repo = await import("@/db/repo");
    await repo.deleteDatedSlots(AMIR.id);
    await handleUpdate(text(PRIVATE_AMIR, AMIR, "/busy"));
    await handleUpdate(text(PRIVATE_AMIR, AMIR, "12.09 весь день"));

    const dated = (await repo.getSlots(AMIR.id)).filter((slot) => slot.specificDate !== null);
    expect([dated[0].startMin, dated[0].endMin]).toEqual([0, 1440]);
    await repo.deleteDatedSlots(AMIR.id);
  });

  it("после /busy свободный текст снова идёт в импорт расписания", async () => {
    await handleUpdate(text(PRIVATE_AMIR, AMIR, "Ср 10:00-11:00"));
    expect(stub.lastText()).toContain("Я так понял твоё расписание");
  });

  it("/clear просит подтверждение и удаляет", async () => {
    await handleUpdate(text(PRIVATE_ASEL, ASEL, "/clear"));
    expect(stub.lastText()).toContain("Точно удалить");

    await handleUpdate(callback(PRIVATE_ASEL as never, ASEL, "clr:yes"));
    const repo = await import("@/db/repo");
    expect(await repo.getSlots(ASEL.id)).toEqual([]);
    expect(await repo.isFilled(ASEL.id)).toBe(false);
    // Возвращаем расписание — оно нужно следующим сценариям.
    await repo.replaceWeeklySlots(
      ASEL.id,
      [0, 1, 2, 3, 4, 5, 6],
      [{ weekday: 0, start: 540, end: 630 }],
      "wizard",
    );
  });
});

describe("/availability", () => {
  it("в группе показывает общие окна", async () => {
    await handleUpdate(text(GROUP_CHAT, AMIR, "/availability"));
    const body = stub.lastText();
    expect(body).toContain("Общие свободные окна");
    expect(body).toContain("Рабочее окно: 08:00–22:00");
  });

  it("понимает минимальную длительность", async () => {
    await handleUpdate(text(GROUP_CHAT, AMIR, "/availability 90"));
    expect(stub.lastText()).toContain("минимум 90 мин");
  });

  it("кворум в процентах смягчает требования и называет отсутствующих", async () => {
    await handleUpdate(text(GROUP_CHAT, AMIR, "/availability 50%"));
    const body = stub.lastText();
    expect(body).toContain("свободны хотя бы 1 из 2");
  });

  it("в новом чате подключает вызвавшего сам, не требуя /setup", async () => {
    const other = { id: -100999, type: "supergroup" as const, title: "Другой" };
    await handleUpdate(text(other as never, AMIR, "/availability"));
    expect(stub.lastText()).toContain("все участники чата (1)");

    const repo = await import("@/db/repo");
    expect(await repo.isMember(-100999, AMIR.id)).toBe(true);
  });

  it("в личке без единого чата честно говорит, что считать нечего", async () => {
    const loner = { ...AMIR, id: 777001, username: "loner", first_name: "Одиночка" };
    await handleUpdate(
      text({ id: loner.id, type: "private" } as never, loner, "/availability"),
    );
    expect(stub.lastText()).toContain("нет зарегистрированных участников");
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
  });

  it("голос учитывается и карточка перерисовывается", async () => {
    const repo = await import("@/db/repo");
    const meeting = (await repo.chatMeetings(GROUP_ID))[0];

    await handleUpdate(callback(GROUP_CHAT, ASEL, `vote:${meeting.id}:yes`));
    expect(String(stub.last("answerCallbackQuery")?.payload.text)).toContain("Голос учтён");
    expect(stub.lastText("editMessageText")).toContain("✅ Да (1)");

    const answers = await repo.meetingResponsesFor(meeting.id);
    expect(answers.map((row) => row.userId)).toEqual([ASEL.id]);
  });

  it("посторонний проголосовать не может", async () => {
    const repo = await import("@/db/repo");
    const meeting = (await repo.chatMeetings(GROUP_ID))[0];
    const stranger = { ...AMIR, id: 999999, username: "stranger", first_name: "Чужак" };

    stub.reset();
    await handleUpdate(callback(GROUP_CHAT, stranger, `vote:${meeting.id}:yes`));
    const answer = stub.last("answerCallbackQuery")!;
    expect(String(answer.payload.text)).toContain("не в списке приглашённых");
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

    await handleUpdate(reply(GROUP_CHAT, ASEL, "лучше в 16:00", promptId));
    expect(stub.lastText("editMessageText")).toContain("лучше в 16:00");
    expect(stub.lastText()).toContain("Предложение добавлено");

    const answers = await repo.meetingResponsesFor(meeting.id);
    expect(answers[0].answer).toBe("change");
    expect(answers[0].comment).toBe("лучше в 16:00");
  });

  it("отменить встречу может только организатор", async () => {
    const repo = await import("@/db/repo");
    const meeting = (await repo.chatMeetings(GROUP_ID))[0];

    await handleUpdate(callback(GROUP_CHAT, ASEL, `card:cancel:${meeting.id}`));
    expect(String(stub.last("answerCallbackQuery")?.payload.text)).toContain("только тот, кто её создал");
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
  it("/settings показывает текущие значения", async () => {
    await handleUpdate(text(GROUP_CHAT, AMIR, "/settings"));
    const body = stub.lastText();
    expect(body).toContain("Рабочее окно: <b>08:00–22:00</b>");
    expect(body).toContain("Asia/Almaty");
  });

  it("/settings меняет часы и буфер", async () => {
    await handleUpdate(text(GROUP_CHAT, AMIR, "/settings hours 9:00 21:00"));
    expect(stub.lastText()).toContain("Настройки обновлены");
    await handleUpdate(text(GROUP_CHAT, AMIR, "/settings buffer 20"));

    const repo = await import("@/db/repo");
    const chat = await repo.getChat(GROUP_ID);
    expect([chat?.dayStartMin, chat?.dayEndMin]).toEqual([540, 1260]);
    expect(chat?.travelBufferMin).toBe(20);
  });

  it("/settings отвергает бессмыслицу", async () => {
    await handleUpdate(text(GROUP_CHAT, AMIR, "/settings tz Nowhere/Nothing"));
    expect(stub.lastText()).toContain("Не понял параметр");
    await handleUpdate(text(GROUP_CHAT, AMIR, "/settings hours 22:00 9:00"));
    expect(stub.lastText()).toContain("Не понял параметр");
  });

  it("/settings недоступен обычному участнику", async () => {
    stub.memberStatus = "member";
    await handleUpdate(text(GROUP_CHAT, ASEL, "/settings min 45"));
    expect(stub.lastText()).toContain("администратор");
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

  it("/link присылает персональную ссылку в личку", async () => {
    stub.reset();
    await handleUpdate(text(GROUP_CHAT, AMIR, "/link"));

    const dm = stub.of("sendMessage").find((call) => call.payload.chat_id === AMIR.id)!;
    const markup = dm.payload.reply_markup as { inline_keyboard: { url: string }[][] };
    expect(markup.inline_keyboard[0][0].url).toMatch(
      /^https:\/\/qairu\.example\/g\/[a-z0-9]{8}\?t=[\w-]+$/,
    );
    expect(stub.lastText()).toContain("Отправил тебе ссылку");
  });

  it("/leave убирает из списка, но расписание остаётся", async () => {
    const repo = await import("@/db/repo");
    await handleUpdate(text(GROUP_CHAT, ASEL, "/leave"));
    expect(await repo.isMember(GROUP_ID, ASEL.id)).toBe(false);
    expect((await repo.getSlots(ASEL.id)).length).toBeGreaterThan(0);
    await repo.addMembership(GROUP_ID, ASEL.id);
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
    expect(stub.lastText()).toContain("Команды QairuCowork");
  });
});
