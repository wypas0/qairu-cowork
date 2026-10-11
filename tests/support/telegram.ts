/**
 * Заглушка Bot API.
 *
 * Перехватывает fetch на api.telegram.org, записывает вызовы и отвечает так же,
 * как настоящий Telegram. Позволяет прогнать весь маршрутизатор апдейтов, ни
 * разу не выйдя в сеть.
 */

export type Call = { method: string; payload: Record<string, unknown> };

export type TelegramStub = {
  calls: Call[];
  /** Все вызовы указанного метода. */
  of: (method: string) => Call[];
  /** Последний вызов указанного метода. */
  last: (method: string) => Call | undefined;
  /** Текст последнего отправленного сообщения. */
  lastText: (method?: string) => string;
  reset: () => void;
  /** Статус, который вернёт getChatMember. */
  memberStatus: string;
  /** id администраторов, которых вернёт getChatAdministrators. */
  adminIds: number[];
  /** id пользователей, которым бот «не может написать первым» (403). */
  blockedIds: number[];
  /** Ошибка, которой ответит getChatAdministrators; null — ответить списком. */
  adminsError: { code: number; description: string } | "network" | null;
  /** getMe скажет, что у бота включено главное мини-приложение. */
  hasMainWebApp: boolean;
  nextMessageId: number;
  /** Столько следующих sendMessage получат 429 с этим `retry_after` (секунды). */
  rateLimit: { times: number; retryAfter: number } | null;
  /** sendMessage не отвечает, пока запрос не оборвут по сигналу. */
  hang: boolean;
  /** Был ли у каждого вызова сигнал отмены (таймаут). */
  signals: boolean[];
};

export const BOT_ID = 5000001;
export const BOT_USERNAME = "qairucoworkbot";

export function installTelegramStub(): TelegramStub {
  const stub: TelegramStub = {
    calls: [],
    of: (method) => stub.calls.filter((call) => call.method === method),
    last: (method) => [...stub.calls].reverse().find((call) => call.method === method),
    lastText: (method = "sendMessage") => String(stub.last(method)?.payload.text ?? ""),
    reset: () => {
      stub.calls.length = 0;
      stub.signals.length = 0;
      stub.rateLimit = null;
      stub.hang = false;
    },
    memberStatus: "creator",
    adminIds: [],
    blockedIds: [],
    adminsError: null,
    hasMainWebApp: false,
    nextMessageId: 1000,
    rateLimit: null,
    hang: false,
    signals: [],
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const match = /api\.telegram\.org\/bot[^/]+\/(\w+)/.exec(url);
    if (!match) throw new Error(`неожиданный запрос в тесте: ${url}`);

    const method = match[1];
    let payload: Record<string, unknown> = {};
    if (typeof init?.body === "string") payload = JSON.parse(init.body) as Record<string, unknown>;
    else if (init?.body instanceof FormData) {
      payload = Object.fromEntries(
        [...init.body.entries()].map(([key, value]) => [
          key,
          value instanceof Blob ? `<blob ${value.size}b>` : value,
        ]),
      );
    }
    stub.calls.push({ method, payload });
    stub.signals.push(init?.signal instanceof AbortSignal);

    if (method === "sendMessage" && stub.hang) {
      const signal = init?.signal;
      return new Promise<Response>((_, reject) => {
        if (!signal) return; // без сигнала — висит вечно, как настоящий зависший сокет
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    }
    if (method === "sendMessage" && stub.rateLimit && stub.rateLimit.times > 0) {
      stub.rateLimit.times -= 1;
      return new Response(
        JSON.stringify({
          ok: false,
          error_code: 429,
          description: `Too Many Requests: retry after ${stub.rateLimit.retryAfter}`,
          parameters: { retry_after: stub.rateLimit.retryAfter },
        }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      );
    }

    const adminsError = stub.adminsError;
    if (method === "getChatAdministrators" && adminsError === "network") {
      throw new TypeError("fetch failed");
    }
    if (method === "getChatAdministrators" && adminsError && adminsError !== "network") {
      return new Response(
        JSON.stringify({ ok: false, error_code: adminsError.code, description: adminsError.description }),
        { status: adminsError.code, headers: { "Content-Type": "application/json" } },
      );
    }
    if (method === "sendMessage" && stub.blockedIds.includes(Number(payload.chat_id))) {
      return new Response(
        JSON.stringify({ ok: false, error_code: 403, description: "Forbidden: bot can't initiate conversation with a user" }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }

    const result = (() => {
      switch (method) {
        case "getMe":
          return {
            id: BOT_ID,
            is_bot: true,
            username: BOT_USERNAME,
            first_name: "QairuCowork",
            has_main_web_app: stub.hasMainWebApp,
          };
        case "getChatMember":
          return { status: stub.memberStatus };
        case "getChatAdministrators":
          return stub.adminIds.map((id) => ({
            status: "administrator",
            user: { id, is_bot: false, first_name: `admin${id}` },
          }));
        case "sendMessage":
          return {
            message_id: stub.nextMessageId++,
            chat: { id: payload.chat_id, type: "group" },
            date: Math.floor(Date.now() / 1000),
            text: payload.text,
          };
        default:
          return true;
      }
    })();

    return new Response(JSON.stringify({ ok: true, result }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  return stub;
}
