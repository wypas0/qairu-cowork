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
  nextMessageId: number;
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
    },
    memberStatus: "creator",
    nextMessageId: 1000,
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

    const result = (() => {
      switch (method) {
        case "getMe":
          return { id: BOT_ID, is_bot: true, username: BOT_USERNAME, first_name: "QairuCowork" };
        case "getChatMember":
          return { status: stub.memberStatus };
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
