/**
 * DNS rebinding: проверка адреса до запроса видит публичный адрес, а сокету
 * DNS отдаёт 127.0.0.1. Здесь настоящий undici и настоящий сокет — только DNS
 * подменён. До сети дело не доходит: подключение обрывается на выборе адреса.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));

vi.mock("node:dns", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:dns")>();
  const lookup = (_hostname: string, _options: unknown, callback: (...args: unknown[]) => void) =>
    callback(null, [{ address: "127.0.0.1", family: 4 }]);
  return { ...actual, default: { ...actual, lookup }, lookup };
});

describe("DNS rebinding", () => {
  it("сокет не идёт на 127.0.0.1, хотя проверка до запроса видела публичный адрес", async () => {
    const { fetchCalendar } = await import("@/lib/calendarSync");
    expect(await fetchCalendar("https://rebind.example.com/cal.ics")).toEqual({ ok: false, error: "blocked" });
  });

  it("checkedLookup отказывает адресам внутренней сети", async () => {
    const { checkedLookup } = await import("@/lib/calendarSync");
    const error = await new Promise<NodeJS.ErrnoException | null>((resolve) =>
      checkedLookup("rebind.example.com", { all: true }, (failure) => resolve(failure)),
    );
    expect(error?.code).toBe("EQAIRUBLOCKED");
  });
});
