/**
 * Проверка запросов на настоящем драйвере.
 *
 * Остальные тесты подменяют соединение drizzle-адаптером PGlite — это быстро,
 * но скрывает разницу в кодировании параметров. Здесь поднимается Postgres по
 * сетевому протоколу и подключается ровно тот драйвер (`postgres.js`), который
 * работает на Vercel. Так ловятся ошибки вроде «Date внутри sql-фрагмента»:
 * у параметра нет типа, и драйвер падает на сериализации.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PORT = 5546;
let server: PGLiteSocketServer;

beforeAll(async () => {
  const db = new PGlite();
  const sqlPath = fileURLToPath(new URL("../drizzle/0000_init.sql", import.meta.url));
  const migration = await readFile(sqlPath, "utf8");
  for (const statement of migration.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed) await db.exec(trimmed);
  }

  server = new PGLiteSocketServer({ db, port: PORT, host: "127.0.0.1" });
  await server.start();
  process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`;
});

afterAll(async () => {
  await server?.stop();
});

async function repo() {
  return import("@/db/repo");
}

describe("настоящий драйвер postgres.js", () => {
  it("выборка напоминаний не падает на сериализации момента времени", async () => {
    const r = await repo();
    await r.upsertUser({ userId: 9001, username: "amir", fullName: "Амир" });
    await r.upsertChat(-777, "Драйвер");
    await r.updateChat(-777, { reminderMin: 30 });
    await r.addMembership(-777, 9001);

    const start = new Date(Date.now() + 20 * 60_000);
    const meeting = await r.createMeeting({
      chatId: -777,
      initiatorId: 9001,
      place: "Библиотека",
      whenText: "скоро",
      goal: "Разбор задач",
      invitees: [9001],
      whenStart: start,
    });

    const due = await r.meetingsDueForReminder(new Date());
    expect(due.map((row) => row.meeting.id)).toContain(meeting.id);
    expect(due[0].chat.reminderMin).toBe(30);

    // За час до порога напоминание ещё рано слать.
    const early = new Date(start.getTime() - 90 * 60_000);
    expect((await r.meetingsDueForReminder(early)).map((row) => row.meeting.id)).not.toContain(
      meeting.id,
    );
  });

  it("timestamptz переживает круг через базу без сдвига", async () => {
    const r = await repo();
    const exact = new Date("2026-09-16T05:00:00.000Z");
    const meeting = await r.createMeeting({
      chatId: -777,
      initiatorId: 9001,
      place: "",
      whenText: "",
      goal: "",
      invitees: [9001],
      whenStart: exact,
    });
    expect((await r.getMeeting(meeting.id))?.whenStart?.toISOString()).toBe(
      "2026-09-16T05:00:00.000Z",
    );
  });

  it("поиск по username без учёта регистра работает через сырой SQL", async () => {
    const r = await repo();
    expect((await r.findUserByUsername("@AMIR"))?.userId).toBe(9001);
    expect(await r.findUserByUsername("нет-такого")).toBeNull();
  });

  it("upsert-ы чата, отметки и ответа не конфликтуют сами с собой", async () => {
    const r = await repo();
    await r.upsertChat(-777, "");
    expect((await r.getChat(-777))?.title).toBe("Драйвер");

    await r.markFilled(9001, true);
    await r.markFilled(9001, false);
    expect(await r.isFilled(9001)).toBe(false);

    const meeting = (await r.chatMeetings(-777))[0];
    await r.setResponse({ meetingId: meeting.id, userId: 9001, answer: "yes" });
    await r.setResponse({ meetingId: meeting.id, userId: 9001, answer: "no", comment: "занят" });
    const answers = await r.meetingResponsesFor(meeting.id);
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({ answer: "no", comment: "занят" });
  });

  it("даты хранятся строками и не уезжают на день", async () => {
    const r = await repo();
    await r.addRangeSlot({
      userId: 9001,
      dateFrom: "2026-09-15",
      dateTo: "2026-09-20",
      start: 0,
      end: 1440,
    });
    await r.updateChat(-777, { semesterStart: "2026-09-01" });

    const slot = (await r.getSlots(9001)).find((row) => row.dateFrom !== null)!;
    expect([slot.dateFrom, slot.dateTo]).toEqual(["2026-09-15", "2026-09-20"]);
    expect((await r.getChat(-777))?.semesterStart).toBe("2026-09-01");
  });

  it("транзакция откатывается целиком", async () => {
    const r = await repo();
    await expect(
      r.transaction(async (tx) => {
        await r.upsertUser({ userId: 9002, username: null, fullName: "Призрак" }, tx);
        throw new Error("сбой");
      }),
    ).rejects.toThrow("сбой");
    expect(await r.getUser(9002)).toBeNull();
  });
});
