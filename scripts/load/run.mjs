// Нагрузочный тест: выдержит ли сайт. Без зависимостей — undici уже есть в проекте.
//
//   npm run load -- --scenario board --ramp 5,10,20,50
//   npm run load -- --help
//
// Подробно — scripts/load/README.md.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { Agent } from "undici";

import { env } from "../env.mjs";
import {
  KNOWN_PROD_URLS,
  THRESHOLDS,
  applySafety,
  classifyTarget,
  findKnee,
  formatStatuses,
  formatTable,
  parseArgs,
  summarize,
  verdict,
} from "./lib.mjs";
import { REQUESTS, nextRequest, probeUpdate, weightsFor } from "./scenarios.mjs";

const HELP = `npm run load -- [параметры]

  --target <url>        куда (по умолчанию http://localhost:3230 — e2e-сервер)
  --scenario <имя>      board | save | bot | mixed (по умолчанию board)
  --concurrency <n>     одновременных запросов (по умолчанию 10)
  --ramp 5,10,20,50     ступени параллельности — где загибается
  --duration <время>    длительность ступени: 20s, 1m (по умолчанию 20s)
  --requests <n>        или столько запросов на ступень
  --slug <код>          группа (локально — из e2e/.state.json)
  --token <токен>       кука qairu_token участника (или LOAD_TOKEN)
  --bot-secret <s>      секрет вебхука (или LOAD_BOT_SECRET; локально — из .state.json)
  --state <файл>        состояние e2e-сервера (по умолчанию e2e/.state.json)
  --out <файл>          куда записать JSON (по умолчанию .load/<время>-<сценарий>.json)
  --timeout <мс>        таймаут запроса (по умолчанию 15000)
  --vercel-bypass <s>   секрет Protection Bypass for Automation превью (или LOAD_VERCEL_BYPASS)
  --no-warmup           без прогрева
  --i-know-this-is-prod разрешить боевой сайт (параллельность ≤ 5, ступень ≤ 30 с)
  --allow-real-bot      разрешить bot там, где бот настоящий

Сценарий bot без --allow-real-bot идёт только против
  node scripts/dev/e2e-server.mjs 3230 --fake-bot
где Telegram подменён заглушкой.`;

/**
 * Заголовки ко всем запросам. x-vercel-protection-bypass — пропуск через защиту
 * превью-деплоя (Vercel → Settings → Deployment Protection → Protection Bypass
 * for Automation): без него превью отвечает 401 страницей входа Vercel.
 * @type {Record<string, string>}
 */
const extraHeaders = {};

/** @param {string} message */
function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(2);
}

/**
 * Состояние e2e-сервера — если он на этом же адресе.
 * @param {string} path
 * @param {string} origin
 */
async function readState(path, origin) {
  let state;
  try {
    state = JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
  try {
    if (new URL(state.url).origin !== origin) return null;
  } catch {
    return null;
  }
  return state;
}

/** @param {any} error */
function errorStatus(error) {
  const code = error?.code ?? error?.name;
  if (code === "UND_ERR_HEADERS_TIMEOUT" || code === "UND_ERR_BODY_TIMEOUT" || code === "TimeoutError" || code === "AbortError") {
    return "timeout";
  }
  if (code === "ECONNREFUSED") return "refused";
  if (code === "ECONNRESET" || code === "UND_ERR_SOCKET") return "reset";
  return String(code ?? "error");
}

/**
 * Один запрос: время до последнего байта тела.
 * @param {Agent} agent
 * @param {string} origin
 * @param {import("./scenarios.mjs").LoadRequest} spec
 * @param {number} timeoutMs
 * @returns {Promise<import("./lib.mjs").Sample & { text?: string }>}
 */
async function send(agent, origin, spec, timeoutMs) {
  const started = performance.now();
  try {
    const response = await agent.request({
      origin,
      path: spec.path,
      method: spec.method,
      headers: { ...extraHeaders, ...spec.headers },
      body: spec.body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.body.text();
    const ms = performance.now() - started;
    return { kind: spec.kind, status: response.statusCode, ok: spec.expect(response.statusCode, text), ms, bytes: text.length, text };
  } catch (error) {
    return { kind: spec.kind, status: errorStatus(error), ok: false, ms: performance.now() - started };
  }
}

/**
 * Одна ступень: `concurrency` работников крутят запросы, пока не выйдет время
 * или не кончится лимит запросов.
 */
async function runStep({ origin, weights, ctx, concurrency, durationS, requests, timeoutMs }) {
  const agent = new Agent({
    connections: concurrency,
    pipelining: 1,
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
    keepAliveTimeout: 10_000,
  });
  /** @type {import("./lib.mjs").Sample[]} */
  const samples = [];
  const started = performance.now();
  const deadline = durationS === null ? Infinity : started + durationS * 1000;
  let issued = 0;

  const worker = async () => {
    for (;;) {
      if (requests !== null) {
        if (issued >= requests) return;
        issued++;
      } else if (performance.now() >= deadline) {
        return;
      }
      const sample = await send(agent, origin, nextRequest(weights, ctx, Math.random), timeoutMs);
      delete sample.text;
      samples.push(sample);
    }
  };

  const ticker =
    process.stdout.isTTY && durationS !== null
      ? setInterval(() => {
          const left = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
          process.stdout.write(`\r  … ${concurrency} параллельно, ${samples.length} запросов, осталось ${left} с   `);
        }, 1000)
      : null;
  await Promise.all(Array.from({ length: concurrency }, worker));
  if (ticker) {
    clearInterval(ticker);
    process.stdout.write("\r\x1b[2K");
  }
  const elapsedS = (performance.now() - started) / 1000;
  await agent.close();

  /** @type {Record<string, ReturnType<typeof summarize>>} */
  const byKind = {};
  for (const kind of new Set(samples.map((sample) => sample.kind))) {
    byKind[kind] = summarize(
      samples.filter((sample) => sample.kind === kind),
      elapsedS,
    );
  }
  return { concurrency, elapsedS: Math.round(elapsedS * 10) / 10, summary: summarize(samples, elapsedS), byKind };
}

const ms = (value) => (value === null ? "—" : `${value}`);

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    fail(/** @type {Error} */ (error).message);
  }
  if (options.help) {
    console.log(HELP);
    return;
  }

  const prodUrls = [...KNOWN_PROD_URLS, env("NEXT_PUBLIC_SITE_URL"), env("WEB_BASE_URL")].filter(
    (value) => typeof value === "string",
  );
  let target;
  try {
    target = classifyTarget(options.target, prodUrls);
  } catch (error) {
    fail(/** @type {Error} */ (error).message);
  }
  const origin = target.origin;
  const bypass = options.vercelBypass ?? env("LOAD_VERCEL_BYPASS");
  if (bypass) extraHeaders["x-vercel-protection-bypass"] = bypass;

  // Локально — данные e2e-сервера: группа, два входа (Амир и Болат), секрет бота.
  const state = target.kind === "local" ? await readState(options.statePath, origin) : null;
  const slug = options.slug ?? env("LOAD_SLUG") ?? state?.slug ?? null;
  const tokenArg = options.token ?? env("LOAD_TOKEN");
  const tokens = tokenArg ? [tokenArg] : [state?.token, state?.tokenEmpty].filter(Boolean);
  const botSecret = options.botSecret ?? env("LOAD_BOT_SECRET") ?? state?.bot?.secret ?? null;
  const fakeBotProven = Boolean(state?.bot?.fake && botSecret && botSecret === state.bot.secret);

  // Смесь без секрета идёт без бота.
  const usesBot = options.scenario === "bot" || (options.scenario === "mixed" && Boolean(botSecret));

  let plan;
  try {
    plan = applySafety(options, target, { fakeBotProven, usesBot });
  } catch (error) {
    fail(/** @type {Error} */ (error).message);
  }

  const needsSite = options.scenario !== "bot";
  if (needsSite && (!slug || tokens.length === 0)) {
    fail(
      target.kind === "local"
        ? `нет данных для входа: не найден ${options.statePath} от e2e-сервера на ${origin}. ` +
            "Запустите `node scripts/dev/e2e-server.mjs 3230` или задайте --slug и --token."
        : "для этого адреса нужны --slug <код группы> и --token <кука qairu_token участника этой группы>.",
    );
  }
  if (options.scenario === "bot" && !botSecret) {
    fail("нужен секрет вебхука: --bot-secret (локально его пишет `e2e-server.mjs 3230 --fake-bot`).");
  }

  console.log(`\nЦель: ${origin} (${target.reason}), сценарий ${options.scenario}`);
  for (const warning of plan.warnings) console.log(`⚠ ${warning}`);
  if (options.scenario === "mixed" && !botSecret) console.log("⚠ mixed без бота: нет секрета вебхука");
  if (target.kind === "prod") {
    console.log(
      "⚠ Vercel Hobby: месячные квоты функций и защита от DDoS (может начать отвечать 429/челленджем);\n" +
        "  Supabase Free: ограниченный пул соединений пулера; настоящий Telegram-бот на том же деплое.",
    );
  }

  // ---------- проверка цели ----------
  const probe = new Agent({ connections: 1 });
  const ctx = { origin, slug, tokens, botSecret, botEnabled: usesBot };
  const health = await send(
    probe,
    origin,
    { kind: "healthz", method: "GET", path: "/api/healthz", headers: {}, expect: (status) => status === 200 },
    options.timeoutMs,
  );
  if (!health.ok) {
    await probe.close();
    fail(
      `${origin}/api/healthz не отвечает (${health.status}). ` +
        (target.kind === "local"
          ? "Сервер запущен? npx next build && node scripts/dev/e2e-server.mjs 3230"
          : health.status === 401
            ? "Превью под защитой Vercel: --vercel-bypass <секрет> (README)."
            : "Адрес верный, деплой живой?"),
    );
  }
  if (needsSite) {
    const page = await send(probe, origin, REQUESTS["board-page"](ctx, () => 0), options.timeoutMs);
    if (!page.ok) {
      await probe.close();
      fail(`GET /g/${slug} → ${page.status}: кука не подошла или нет такой группы (307 — редирект на вход/вступление).`);
    }
  }
  if (usesBot) {
    const spec = { ...REQUESTS.bot(ctx, Math.random), body: JSON.stringify(probeUpdate()) };
    const answer = await send(probe, origin, spec, options.timeoutMs);
    if (answer.status === 200 && answer.text === "bot disabled") {
      if (options.scenario === "bot") {
        await probe.close();
        fail(
          "на сервере нет BOT_TOKEN: вебхук отвечает «bot disabled», не трогая базу, — мерить нечего. " +
            "Локально: node scripts/dev/e2e-server.mjs 3230 --fake-bot",
        );
      }
      console.log("⚠ на сервере нет BOT_TOKEN — mixed идёт без бота");
      ctx.botEnabled = false;
    } else if (!answer.ok) {
      await probe.close();
      fail(`вебхук ответил ${answer.status}${answer.status === 401 ? ": секрет не тот" : ""}.`);
    }
  }
  await probe.close();

  const weights = weightsFor(options.scenario, ctx);

  // ---------- прогрев ----------
  // Первые запросы к свежему серверу — холодный старт (загрузка модулей,
  // соединение с базой): в замер ступеней не идут, но показываются отдельно.
  /** @type {Record<string, number>} */
  const warmup = {};
  if (options.warmup) {
    const agent = new Agent({ connections: 1 });
    for (const { kind } of weights) {
      for (let i = 0; i < 3; i++) {
        const sample = await send(agent, origin, REQUESTS[kind](ctx, Math.random), options.timeoutMs);
        if (i === 0) warmup[kind] = Math.round(sample.ms);
      }
    }
    await agent.close();
    console.log(`Прогрев, первый запрос: ${Object.entries(warmup).map(([kind, value]) => `${kind} ${value} мс`).join(", ")}`);
  }

  // ---------- ступени ----------
  const header = ["паралл.", "запросов", "rps", "p50", "p95", "p99", "max", "ошибки", "коды", "вердикт"];
  const row = (step) => [
    step.concurrency,
    step.summary.count,
    step.summary.rps,
    ms(step.summary.p50),
    ms(step.summary.p95),
    ms(step.summary.p99),
    ms(step.summary.max),
    `${(step.summary.errorRate * 100).toFixed(1)}%`,
    formatStatuses(step.summary.statuses),
    verdict(step.summary),
  ];
  const per = plan.requests !== null ? `${plan.requests} запросов` : `${plan.durationS} с`;
  console.log(`Ступени: ${plan.steps.join(", ")} одновременно, по ${per}; задержки — мс до последнего байта.`);

  const steps = [];
  for (const concurrency of plan.steps) {
    const step = await runStep({
      origin,
      weights,
      ctx,
      concurrency,
      durationS: plan.durationS,
      requests: plan.requests,
      timeoutMs: options.timeoutMs,
    });
    steps.push(step);
    const { summary } = step;
    console.log(
      `  ${concurrency} параллельно: ${summary.count} запросов, ${summary.rps} rps, p95 ${ms(summary.p95)} мс, ` +
        `ошибок ${(summary.errorRate * 100).toFixed(1)}% — ${verdict(summary)}`,
    );
    // Сервер упал — дальше мерить нечего.
    if (step.summary.count > 0 && (step.summary.statuses.refused ?? 0) === step.summary.count) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log(`\n${formatTable(header, steps.map(row))}`);

  if (weights.length > 1) {
    const kinds = weights.map((item) => item.kind);
    const rows = [];
    for (const step of steps) {
      for (const kind of kinds) {
        const summary = step.byKind[kind];
        if (!summary) continue;
        rows.push([step.concurrency, kind, summary.count, ms(summary.p50), ms(summary.p95), `${(summary.errorRate * 100).toFixed(1)}%`]);
      }
    }
    console.log(`\nПо запросам:\n${formatTable(["паралл.", "запрос", "n", "p50", "p95", "ошибки"], rows)}`);
  }

  const knee = findKnee(steps);
  const best = steps.reduce((top, step) => (step.summary.rps > (top?.summary.rps ?? -1) ? step : top), null);
  const holding = steps.filter((step) => verdict(step.summary) === "ДЕРЖИТ");
  console.log("");
  console.log(
    `Итог: максимум ${best?.summary.rps ?? 0} rps на ${best?.concurrency ?? "—"} параллельных; ` +
      (holding.length
        ? `держит (p95 ≤ ${THRESHOLDS.p95Ok} мс, ошибок ≤ ${THRESHOLDS.errorRate * 100}%) до ${holding[holding.length - 1].concurrency} параллельных`
        : "ни одна ступень не уложилась в пороги") +
      (knee ? `; загиб на ${knee.concurrency}: ${knee.reason}.` : "; загиба на этих ступенях не видно."),
  );
  if (target.kind === "local") {
    console.log(
      "Локально база — PGlite в памяти на одном соединении (DATABASE_POOL_MAX=1): это цифры кода сайта\n" +
        "и очереди к одному соединению на одной машине, а не Supabase и не Vercel. Инфраструктуру — на превью (README).",
    );
  }

  // ---------- JSON ----------
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outPath = options.out ?? fileURLToPath(new URL(`../../.load/${stamp}-${options.scenario}.json`, import.meta.url));
  if (!options.out) await mkdir(new URL("../../.load/", import.meta.url), { recursive: true });
  const result = {
    at: new Date().toISOString(),
    target: origin,
    targetKind: target.kind,
    scenario: options.scenario,
    weights,
    botEnabled: ctx.botEnabled,
    fakeBot: fakeBotProven,
    steps: plan.steps,
    durationS: plan.durationS,
    requests: plan.requests,
    warmup,
    thresholds: THRESHOLDS,
    results: steps.map((step) => ({ ...step, verdict: verdict(step.summary) })),
    knee,
    notes: target.kind === "local" ? ["PGlite, одно соединение (DATABASE_POOL_MAX=1): цифры кода сайта, не Supabase/Vercel"] : [],
  };
  await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`\nJSON: ${outPath}`);
}

await main();
