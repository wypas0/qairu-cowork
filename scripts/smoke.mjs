// Проверка живого сайта после деплоя: главная, здоровье с базой, закрытые
// адреса закрыты. Запускает `.github/workflows/smoke.yml` после каждого
// деплоя на Production; можно и руками:
//
//   node scripts/smoke.mjs                          # https://qairu-cowork.vercel.app
//   SMOKE_URL=http://localhost:3220 node scripts/smoke.mjs
//   SMOKE_SHA=<коммит> node scripts/smoke.mjs        # сначала дождаться этого коммита
//
// Без секретов: всё, что проверяется, видит любой посетитель.
//
// Vercel сообщает «деплой готов» чуть раньше, чем на него переключается адрес
// сайта, — поэтому при заданном SMOKE_SHA скрипт сперва ждёт (до SMOKE_WAIT_S,
// по умолчанию 180 с), пока /api/healthz не покажет этот коммит, а каждую
// проверку повторяет до трёх раз.

import { env } from "./env.mjs";

const BASE = (env("SMOKE_URL") ?? env("SITE_URL") ?? "https://qairu-cowork.vercel.app").replace(/\/+$/, "");
const SHA = env("SMOKE_SHA")?.slice(0, 7);
const WAIT_S = Number(env("SMOKE_WAIT_S")) || 180;
const BRAND = "QairuCowork";
const ATTEMPTS = 3;
const PAUSE_MS = 5_000;
const ON_GITHUB = env("GITHUB_ACTIONS") === "true";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Запрос без перехода по редиректам: редирект на вход Vercel — это провал, а не успех. */
async function get(path, headers = {}) {
  const response = await fetch(`${BASE}${path}`, {
    redirect: "manual",
    headers: { "User-Agent": "qairu-smoke", ...headers },
    signal: AbortSignal.timeout(15_000),
  });
  return { status: response.status, headers: response.headers, text: await response.text() };
}

function brief(text) {
  return text.replace(/\s+/g, " ").slice(0, 200);
}

/** Проверки: каждая бросает Error с понятной причиной. */
const CHECKS = [
  [
    "главная отвечает 200 и называет себя",
    async () => {
      const { status, text } = await get("/");
      if (status !== 200) throw new Error(`/ ответил ${status}, ждали 200`);
      if (!text.includes(BRAND)) throw new Error(`на / нет «${BRAND}» — открылась чужая страница?`);
    },
  ],
  [
    "/api/healthz: сайт и база живы",
    async () => {
      const { status, headers, text } = await get("/api/healthz");
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        throw new Error(`/api/healthz ответил ${status} не JSON: ${brief(text)}`);
      }
      if (status !== 200 || body.ok !== true) throw new Error(`/api/healthz ответил ${status}: ${brief(text)}`);
      if (body.db?.ok !== true) throw new Error(`база не отвечает: ${brief(text)}`);
      if (!/no-store/.test(headers.get("cache-control") ?? "")) {
        throw new Error(`/api/healthz кешируется (Cache-Control: ${headers.get("cache-control")})`);
      }
    },
  ],
  [
    "/admin для гостя — 404",
    async () => {
      const { status } = await get("/admin");
      if (status !== 404) throw new Error(`/admin без входа ответил ${status}, ждали 404 — консоль видна посторонним?`);
    },
  ],
  [
    "/extension отвечает 200",
    async () => {
      const { status } = await get("/extension");
      if (status !== 200) throw new Error(`/extension ответил ${status}, ждали 200`);
    },
  ],
  [
    "/api/cron/reminders без секрета закрыт",
    async () => {
      const { status, text } = await get("/api/cron/reminders");
      if (status === 503) {
        console.log("  ! CRON_SECRET на Vercel не задан — напоминания не уходят (DEPLOY.md, шаг 6)");
        return;
      }
      if (status !== 401) {
        throw new Error(`/api/cron/reminders без секрета ответил ${status}, ждали 401 — рассылку может запустить кто угодно: ${brief(text)}`);
      }
    },
  ],
];

/** Ждём, пока адрес сайта переключится на только что собранный коммит. */
async function waitForVersion() {
  const deadline = Date.now() + WAIT_S * 1000;
  let seen = "нет ответа";
  for (;;) {
    try {
      const { status, text } = await get("/api/healthz?live");
      const version = status === 200 ? JSON.parse(text).version : undefined;
      if (version === SHA) {
        console.log(`✓ ${BASE} отдаёт коммит ${SHA}`);
        return;
      }
      seen = version ? `коммит ${version}` : `${status} ${brief(text)}`;
    } catch (error) {
      seen = error instanceof Error ? error.message : String(error);
    }
    if (Date.now() >= deadline) {
      throw new Error(`за ${WAIT_S} с ${BASE} так и не переключился на коммит ${SHA} (сейчас: ${seen})`);
    }
    console.log(`… ждём коммит ${SHA}, сейчас: ${seen}`);
    await sleep(10_000);
  }
}

/** Экранирование команды `::error` GitHub Actions: в заголовке нельзя «:» и «,». */
const escapeData = (text) => text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escapeProperty = (text) => escapeData(text).replace(/:/g, "%3A").replace(/,/g, "%2C");

function fail(title, message) {
  console.log(`✗ ${title}: ${message}`);
  if (ON_GITHUB) console.log(`::error title=${escapeProperty(title)}::${escapeData(message)}`);
}

async function main() {
  console.log(`Проверка ${BASE}${SHA ? ` (коммит ${SHA})` : ""}`);
  if (SHA) {
    try {
      await waitForVersion();
    } catch (error) {
      fail("версия на проде", error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
      return;
    }
  }

  let failed = 0;
  for (const [title, check] of CHECKS) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await check();
        console.log(`✓ ${title}`);
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (attempt < ATTEMPTS) {
          console.log(`… ${title}: ${message} — повтор через ${PAUSE_MS / 1000} с`);
          await sleep(PAUSE_MS);
          continue;
        }
        fail(title, message);
        failed += 1;
        break;
      }
    }
  }
  if (failed) {
    console.log(`\nПровалено проверок: ${failed} из ${CHECKS.length}`);
    process.exitCode = 1;
  } else {
    console.log(`\nВсе ${CHECKS.length} проверок пройдены`);
  }
}

await main();
