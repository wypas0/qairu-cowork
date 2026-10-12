// Из чего состоят сценарии: какие запросы и с какими заголовками. Заголовки —
// как у настоящего браузера на нашем сайте: proxy.ts отклоняет POST в /api/ с
// чужим Origin, а isOwnOrDirect/isSameOriginPost (src/lib/secFetch.ts) смотрят
// на Sec-Fetch-*. Чистые функции — сеть в run.mjs.

import { pickWeighted } from "./lib.mjs";

const UA = "qairu-load/1 (+scripts/load)";

/**
 * Выдуманные Telegram-аккаунты и чаты. Номера за пределами того, что Telegram
 * выдаёт (id людей сейчас — до ~10^10), но в пределах безопасных целых JS и
 * bigint базы: живому человеку бот не ответит даже с настоящим токеном.
 * Группы — отрицательные, не в формате супергрупп (-100…).
 */
export const FAKE_USER_BASE = 8_000_000_000_000_000;
export const FAKE_CHAT_BASE = -8_000_000_000_000_000;
export const FAKE_USERS = 400;
export const FAKE_GROUPS = 20;

/**
 * @typedef {{
 *   origin: string,
 *   slug: string | null,
 *   tokens: string[],
 *   botSecret: string | null,
 *   botEnabled: boolean,
 * }} LoadContext
 *
 * @typedef {{
 *   kind: string,
 *   method: "GET" | "POST",
 *   path: string,
 *   headers: Record<string, string>,
 *   body?: string,
 *   expect: (status: number, text: string) => boolean,
 * }} LoadRequest
 *
 * @typedef {{ kind: string, weight: number }} Weight
 *
 * @typedef {{ id: number, is_bot: boolean, first_name: string, username: string, language_code: string }} FakeUser
 * @typedef {{ id: number, type: string, title?: string, first_name?: string }} FakeChat
 * @typedef {{ message_id: number, from?: FakeUser, chat: FakeChat, date: number, text: string }} FakeMessage
 * @typedef {{
 *   update_id: number,
 *   message?: FakeMessage,
 *   callback_query?: { id: string, from: FakeUser, data: string, message: FakeMessage },
 * }} FakeUpdate
 */

/** @param {LoadContext} ctx @param {() => number} random */
function cookie(ctx, random) {
  const token = ctx.tokens[Math.floor(random() * ctx.tokens.length)];
  return `qairu_token=${token}`;
}

/** Переход по ссылке внутри сайта. */
function pageHeaders(ctx, random) {
  return {
    "user-agent": UA,
    accept: "text/html,application/xhtml+xml",
    cookie: cookie(ctx, random),
    "sec-fetch-site": "same-origin",
    "sec-fetch-mode": "navigate",
    "sec-fetch-dest": "document",
  };
}

/** fetch() со страницы сайта. */
function apiHeaders(ctx, random) {
  return {
    "user-agent": UA,
    accept: "application/json",
    cookie: cookie(ctx, random),
    "sec-fetch-site": "same-origin",
    "sec-fetch-mode": "cors",
    "sec-fetch-dest": "empty",
  };
}

/** 200 — страница отрисована. 307 на /join или /login — кука не подошла, это ошибка теста. */
const okStatus = (status) => status === 200;

/** @type {Record<string, (ctx: LoadContext, random: () => number) => LoadRequest>} */
export const REQUESTS = {
  "board-page": (ctx, random) => ({
    kind: "board-page",
    method: "GET",
    path: `/g/${ctx.slug}`,
    headers: pageHeaders(ctx, random),
    expect: okStatus,
  }),
  "me-page": (ctx, random) => ({
    kind: "me-page",
    method: "GET",
    path: `/g/${ctx.slug}/me`,
    headers: pageHeaders(ctx, random),
    expect: okStatus,
  }),
  // Сетка доски перерисовывается этим запросом при каждом щелчке фильтра (Board.tsx).
  "board-state": (ctx, random) => ({
    kind: "board-state",
    method: "GET",
    path: `/api/g/${ctx.slug}/state?week=0`,
    headers: apiHeaders(ctx, random),
    expect: okStatus,
  }),
  // То же, что автосохранение редактора (ScheduleEditor.tsx): вся неделя целиком.
  "save": (ctx, random) => ({
    kind: "save",
    method: "POST",
    path: `/api/g/${ctx.slug}/schedule`,
    headers: {
      ...apiHeaders(ctx, random),
      "content-type": "application/json",
      origin: ctx.origin,
    },
    body: JSON.stringify({ slots: randomWeek(random) }),
    expect: (status, text) => status === 200 && text.includes('"ok":true'),
  }),
  "bot": (ctx, random) => ({
    kind: "bot",
    method: "POST",
    path: "/api/telegram/webhook",
    headers: {
      "user-agent": UA,
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": ctx.botSecret ?? "",
    },
    body: JSON.stringify(fakeUpdate(random)),
    // Вебхук отвечает 200 «ok» всегда, даже если обработка упала (ошибка — в логе
    // сервера). «bot disabled» — на сервере нет BOT_TOKEN, база не тронута.
    expect: (status, text) => status === 200 && text === "ok",
  }),
};

/**
 * Веса запросов в сценариях.
 * @type {Record<string, Weight[]>}
 */
export const SCENARIO_WEIGHTS = {
  board: [
    { kind: "board-page", weight: 2 },
    { kind: "me-page", weight: 1 },
    { kind: "board-state", weight: 2 },
  ],
  save: [{ kind: "save", weight: 1 }],
  bot: [{ kind: "bot", weight: 1 }],
  // Похоже на вечер перед парами: в основном смотрят, иногда правят, бот — фоном.
  mixed: [
    { kind: "board-page", weight: 4 },
    { kind: "me-page", weight: 2 },
    { kind: "board-state", weight: 4 },
    { kind: "save", weight: 1 },
    { kind: "bot", weight: 2 },
  ],
};

/**
 * Веса сценария с учётом того, что умеет цель: без бота (`bot disabled`) смесь
 * идёт без него.
 * @param {string} scenario
 * @param {{ botEnabled: boolean }} ctx
 * @returns {Weight[]}
 */
export function weightsFor(scenario, ctx) {
  const weights = SCENARIO_WEIGHTS[scenario];
  if (!weights) throw new Error(`нет сценария ${scenario}`);
  return weights.filter((item) => item.kind !== "bot" || ctx.botEnabled);
}

/**
 * Следующий запрос сценария.
 * @param {Weight[]} weights
 * @param {LoadContext} ctx
 * @param {() => number} random
 */
export function nextRequest(weights, ctx, random) {
  return REQUESTS[pickWeighted(weights, random()).kind](ctx, random);
}

/**
 * Неделя пар, как её присылает редактор: 2–3 пары в будни по 90 минут и
 * одно «неудобно».
 * @param {() => number} random
 */
export function randomWeek(random) {
  const starts = [8 * 60, 9 * 60 + 40, 11 * 60 + 20, 13 * 60 + 30, 15 * 60 + 10, 16 * 60 + 50];
  const slots = [];
  for (let weekday = 0; weekday < 5; weekday++) {
    const count = 2 + Math.floor(random() * 2);
    const offset = Math.floor(random() * (starts.length - count + 1));
    for (let i = 0; i < count; i++) {
      const start = starts[offset + i];
      slots.push({ weekday, start, end: start + 90, label: `Пара ${i + 1}`, parity: null, kind: "class" });
    }
  }
  const softDay = Math.floor(random() * 7);
  slots.push({ weekday: softDay, start: 19 * 60, end: 21 * 60, label: "", parity: null, kind: "soft" });
  return slots;
}

let updateId = Math.floor(Date.now() / 1000) * 1000;

/**
 * Апдейт Telegram от выдуманного человека: личка (/start, /help, просто текст)
 * или группа (/join, /members, /free, кнопка «кто заполнил»). Каждый идёт в
 * базу: upsert человека и чата, участие, расчёт окон.
 * @param {() => number} random
 * @returns {FakeUpdate}
 */
export function fakeUpdate(random) {
  const n = Math.floor(random() * FAKE_USERS);
  const from = {
    id: FAKE_USER_BASE + n,
    is_bot: false,
    first_name: `Нагрузка ${n}`,
    username: `qload_${n}`,
    language_code: "ru",
  };
  const group = n % FAKE_GROUPS;
  const groupChat = { id: FAKE_CHAT_BASE - group, type: "group", title: `Нагрузка ${group}` };
  const privateChat = { id: from.id, type: "private", first_name: from.first_name };
  const date = Math.floor(Date.now() / 1000);
  const message = (chat, text) => ({
    update_id: ++updateId,
    message: {
      message_id: updateId % 1_000_000,
      from,
      chat,
      date,
      text,
      ...(text.startsWith("/") ? { entities: [{ type: "bot_command", offset: 0, length: text.split(" ")[0].length }] } : {}),
    },
  });

  const variant = pickWeighted(
    [
      { name: "start", weight: 2 },
      { name: "help", weight: 1 },
      { name: "text", weight: 1 },
      { name: "join", weight: 2 },
      { name: "members", weight: 2 },
      { name: "free", weight: 2 },
      { name: "members-button", weight: 1 },
    ],
    random(),
  ).name;

  switch (variant) {
    case "start":
      return message(privateChat, "/start");
    case "help":
      return message(privateChat, "/help");
    case "text":
      return message(privateChat, "привет");
    case "join":
      return message(groupChat, "/join");
    case "members":
      return message(groupChat, "/members");
    case "free":
      return message(groupChat, "/free");
    default:
      return {
        update_id: ++updateId,
        callback_query: {
          id: String(updateId),
          from,
          data: "members:show",
          message: { message_id: 1, chat: groupChat, date, text: "…" },
        },
      };
  }
}

/** Апдейт без сообщения: вебхук проверяет секрет и ничего не делает. Для проверки цели. */
export function probeUpdate() {
  return { update_id: ++updateId };
}
