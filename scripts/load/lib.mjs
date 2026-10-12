// Чистые части нагрузочного теста: разбор аргументов, правила безопасности
// адреса, перцентили и сводка шага, вердикт, таблица. Без сети и файлов —
// чтобы покрываться юнит-тестами (tests/load.test.ts).

export const DEFAULT_TARGET = "http://localhost:3230";
export const SCENARIOS = ["board", "save", "bot", "mixed"];

/** Боевой адрес по умолчанию; к нему добавляются NEXT_PUBLIC_SITE_URL и WEB_BASE_URL. */
export const KNOWN_PROD_URLS = ["https://qairu-cowork.vercel.app"];

/** Потолки для боевого сайта: Vercel Hobby и Supabase Free общие с живыми людьми. */
export const PROD_LIMITS = { concurrency: 5, durationS: 30, requests: 300 };

/** Telegram — никогда, ни с какими флагами: живой бот и бан за флуд. */
const TELEGRAM_HOST = /(^|\.)telegram\.org$|(^|\.)t\.me$/i;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

const FLAGS = new Set(["i-know-this-is-prod", "allow-real-bot", "help", "no-warmup"]);
const VALUES = new Set([
  "target",
  "scenario",
  "concurrency",
  "duration",
  "requests",
  "ramp",
  "slug",
  "token",
  "bot-secret",
  "state",
  "out",
  "timeout",
  "vercel-bypass",
]);

/**
 * Длительность: `30`, `30s`, `2m`, `1500ms` → секунды.
 * @param {string} raw
 * @returns {number}
 */
export function parseDuration(raw) {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m)?$/.exec(String(raw).trim());
  if (!match) throw new Error(`не понял длительность «${raw}»: пример 30s, 2m`);
  const value = Number(match[1]);
  const unit = match[2] ?? "s";
  const seconds = unit === "ms" ? value / 1000 : unit === "m" ? value * 60 : value;
  if (!(seconds > 0)) throw new Error(`длительность должна быть больше нуля: «${raw}»`);
  return seconds;
}

/**
 * @param {string} raw
 * @param {string} name
 */
function positiveInt(raw, name) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`--${name}: нужно целое число ≥ 1, а не «${raw}»`);
  return value;
}

/**
 * Аргументы командной строки. `--ramp 5,10,20` задаёт ступени параллельности;
 * без него — одна ступень `--concurrency`. `--requests` — сколько запросов на
 * ступень (тогда длительность не действует), иначе — `--duration` на ступень.
 *
 * @param {string[]} argv аргументы без `node` и имени скрипта
 */
export function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const values = {};
  /** @type {Set<string>} */
  const flags = new Set();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) throw new Error(`лишний аргумент «${arg}» (см. --help)`);
    const eq = arg.indexOf("=");
    const name = arg.slice(2, eq === -1 ? undefined : eq);
    if (FLAGS.has(name)) {
      if (eq !== -1) throw new Error(`--${name} — флаг без значения`);
      flags.add(name);
      continue;
    }
    if (!VALUES.has(name)) throw new Error(`неизвестный параметр --${name} (см. --help)`);
    const value = eq === -1 ? argv[++i] : arg.slice(eq + 1);
    if (value === undefined || value === "" || (eq === -1 && value.startsWith("--"))) {
      throw new Error(`--${name}: нет значения`);
    }
    values[name] = value;
  }

  const scenario = values.scenario ?? "board";
  if (!SCENARIOS.includes(scenario)) {
    throw new Error(`--scenario: одно из ${SCENARIOS.join(", ")}, а не «${scenario}»`);
  }

  const ramp = values.ramp
    ? values.ramp.split(",").map((part) => positiveInt(part.trim(), "ramp"))
    : [values.concurrency ? positiveInt(values.concurrency, "concurrency") : 10];
  if (values.ramp && values.concurrency) throw new Error("--ramp и --concurrency вместе не задаются");

  if (values.requests && values.duration) throw new Error("--requests и --duration вместе не задаются");
  const requests = values.requests ? positiveInt(values.requests, "requests") : null;
  const durationS = requests ? null : parseDuration(values.duration ?? "20s");

  return {
    target: values.target ?? DEFAULT_TARGET,
    scenario,
    steps: ramp,
    durationS,
    requests,
    slug: values.slug ?? null,
    token: values.token ?? null,
    botSecret: values["bot-secret"] ?? null,
    statePath: values.state ?? "e2e/.state.json",
    out: values.out ?? null,
    timeoutMs: values.timeout ? positiveInt(values.timeout, "timeout") : 15_000,
    vercelBypass: values["vercel-bypass"] ?? null,
    prodOk: flags.has("i-know-this-is-prod"),
    realBotOk: flags.has("allow-real-bot"),
    warmup: !flags.has("no-warmup"),
    help: flags.has("help"),
  };
}

/**
 * Что за адрес: `local` — свой компьютер, `preview` — превью-деплой Vercel,
 * `prod` — боевой сайт или любой другой домен (свой домен тоже может быть боевым).
 *
 * @param {string} target
 * @param {string[]} prodUrls боевые адреса (KNOWN_PROD_URLS + из окружения)
 * @returns {{ kind: "local" | "preview" | "prod", origin: string, reason: string }}
 */
export function classifyTarget(target, prodUrls = KNOWN_PROD_URLS) {
  let url;
  try {
    url = new URL(target);
  } catch {
    throw new Error(`--target: это не адрес: «${target}»`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`--target: только http(s), а не ${url.protocol}`);
  }
  if (url.username || url.password) throw new Error("--target: без логина и пароля в адресе");
  const host = url.hostname.toLowerCase();
  if (TELEGRAM_HOST.test(host)) {
    throw new Error("--target: в Telegram запросы не шлются никогда — это живой бот и бан за флуд");
  }

  const origin = url.origin;
  if (LOCAL_HOSTS.has(host)) return { kind: "local", origin, reason: "свой компьютер" };

  const prodHosts = new Set(
    prodUrls
      .map((value) => {
        try {
          return new URL(value).hostname.toLowerCase();
        } catch {
          return null;
        }
      })
      .filter(Boolean),
  );
  if (prodHosts.has(host)) return { kind: "prod", origin, reason: "боевой сайт" };
  if (host.endsWith(".vercel.app")) return { kind: "preview", origin, reason: "превью-деплой Vercel" };
  return { kind: "prod", origin, reason: "чужой домен — считается боевым" };
}

/**
 * Правила безопасности до первого запроса. Возвращает итоговые настройки
 * (для боевого — урезанные) и предупреждения; бросает ошибку, если запускать нельзя.
 *
 * @param {ReturnType<typeof parseArgs>} options
 * @param {ReturnType<typeof classifyTarget>} target
 * @param {{ fakeBotProven?: boolean, usesBot?: boolean }} [facts] fakeBotProven — секрет
 *   вебхука взят у локального e2e-сервера с заглушкой Telegram (`--fake-bot`);
 *   usesBot — пойдут ли апдейты в вебхук (mixed без секрета идёт без бота)
 */
export function applySafety(options, target, facts = {}) {
  const warnings = [];
  let { steps, durationS, requests } = options;
  const usesBot = facts.usesBot ?? (options.scenario === "bot" || options.scenario === "mixed");

  if (target.kind === "prod") {
    if (!options.prodOk) {
      throw new Error(
        `${target.origin} — ${target.reason}. Нагрузка на боевой сайт делит лимиты Vercel Hobby и Supabase Free ` +
          "с живыми людьми. Гоняйте превью-деплой с отдельной базой (scripts/load/README.md). " +
          "Если всё же нужно — добавьте --i-know-this-is-prod (параллельность урежется).",
      );
    }
    const capped = steps.map((step) => Math.min(step, PROD_LIMITS.concurrency));
    if (capped.some((step, i) => step !== steps[i])) {
      warnings.push(`боевой сайт: параллельность урезана до ${PROD_LIMITS.concurrency}`);
    }
    steps = [...new Set(capped)];
    if (durationS !== null && durationS > PROD_LIMITS.durationS) {
      warnings.push(`боевой сайт: ступень урезана до ${PROD_LIMITS.durationS} с`);
      durationS = PROD_LIMITS.durationS;
    }
    if (requests !== null && requests > PROD_LIMITS.requests) {
      warnings.push(`боевой сайт: не больше ${PROD_LIMITS.requests} запросов на ступень`);
      requests = PROD_LIMITS.requests;
    }
    warnings.push(
      "это боевой сайт: функции Vercel Hobby, соединения пулера Supabase Free и квоты общие с живыми людьми; " +
        "save перезаписывает расписание аккаунта из --token",
    );
  }

  if (usesBot && !facts.fakeBotProven) {
    if (!options.realBotOk) {
      throw new Error(
        "сценарий bot шлёт апдейты в вебхук; на сервере с настоящим BOT_TOKEN бот пойдёт отвечать " +
          "в api.telegram.org (чаты выдуманные, но запросы настоящие). Без флага он запускается только против " +
          "локального `node scripts/dev/e2e-server.mjs 3230 --fake-bot`, где Telegram подменён заглушкой. " +
          "Если это и нужно — добавьте --allow-real-bot и --bot-secret.",
      );
    }
    warnings.push("bot: на сервере настоящий бот — каждый апдейт уйдёт ответом в api.telegram.org в выдуманные чаты");
  }

  return { steps, durationS, requests, warnings };
}

/**
 * Перцентиль по отсортированному массиву (ближайший ранг).
 * @param {number[]} sorted по возрастанию
 * @param {number} p 0..100
 */
export function percentile(sorted, p) {
  if (sorted.length === 0) return NaN;
  if (p <= 0) return sorted[0];
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, rank) - 1];
}

/**
 * @typedef {{ kind: string, ok: boolean, status: number | string, ms: number, bytes?: number }} Sample
 */

/**
 * Сводка по замерам: число, rps, задержки, ошибки по кодам.
 * @param {Sample[]} samples
 * @param {number} elapsedS сколько длилась ступень
 */
export function summarize(samples, elapsedS) {
  const latencies = samples.map((sample) => sample.ms).sort((a, b) => a - b);
  /** @type {Record<string, number>} */
  const statuses = {};
  /** @type {Record<string, number>} */
  const errors = {};
  let failed = 0;
  let bytes = 0;
  for (const sample of samples) {
    const key = String(sample.status);
    statuses[key] = (statuses[key] ?? 0) + 1;
    if (!sample.ok) {
      failed++;
      errors[key] = (errors[key] ?? 0) + 1;
    }
    bytes += sample.bytes ?? 0;
  }
  const count = samples.length;
  const round = (value) => (Number.isFinite(value) ? Math.round(value) : null);
  return {
    count,
    rps: elapsedS > 0 ? Math.round((count / elapsedS) * 10) / 10 : 0,
    p50: round(percentile(latencies, 50)),
    p95: round(percentile(latencies, 95)),
    p99: round(percentile(latencies, 99)),
    max: round(latencies[latencies.length - 1]),
    errorRate: count ? failed / count : 0,
    errors,
    statuses,
    avgBytes: count ? Math.round(bytes / count) : 0,
  };
}

/** Пороги вердикта: что считать «держит». */
export const THRESHOLDS = { errorRate: 0.01, p95Ok: 800, p95Slow: 2000 };

/**
 * Вердикт ступени одной строкой.
 * @param {ReturnType<typeof summarize>} summary
 */
export function verdict(summary) {
  if (summary.count === 0) return "НЕТ ДАННЫХ";
  if (summary.errorRate > THRESHOLDS.errorRate) return `ОШИБКИ ${(summary.errorRate * 100).toFixed(1)}%`;
  if ((summary.p95 ?? 0) > THRESHOLDS.p95Slow) return "МЕДЛЕННО";
  if ((summary.p95 ?? 0) > THRESHOLDS.p95Ok) return "ТЕРПИМО";
  return "ДЕРЖИТ";
}

/**
 * Где загиб: первая ступень, после которой больше параллельности почти не даёт
 * пропускной способности — запросы просто встают в очередь. Считается от
 * лучшего rps на прошлых ступенях с поправкой на рост параллельности: ×2
 * людей и +10% rps — загиб, ×2 людей и +90% — нет. Провал, который следующие
 * ступени отыгрывают (шум машины, сборка мусора), загибом не считается.
 * Ещё признаки: ошибок больше порога или p95 вырос больше чем вдвое и не вернулся.
 * null — загиба на этих ступенях не видно.
 *
 * @param {{ concurrency: number, summary: ReturnType<typeof summarize> }[]} steps
 */
export function findKnee(steps) {
  let bestRps = 0;
  for (let i = 0; i < steps.length; i++) {
    const { concurrency, summary } = steps[i];
    if (summary.errorRate > THRESHOLDS.errorRate) {
      return { concurrency, reason: `ошибки ${(summary.errorRate * 100).toFixed(1)}%` };
    }
    if (i > 0) {
      const prev = steps[i - 1];
      const later = steps.slice(i + 1).map((step) => step.summary);
      const growth = concurrency / prev.concurrency - 1;
      const gain = bestRps > 0 ? summary.rps / bestRps - 1 : 1;
      const efficiency = growth > 0 ? gain / growth : 1;
      const rpsRecovers = later.some((next) => next.rps > bestRps * 1.15);
      if (efficiency < 0.25 && !rpsRecovers) {
        return {
          concurrency,
          reason: `rps почти не растёт (${bestRps} → ${summary.rps} при ×${(concurrency / prev.concurrency).toFixed(1)} параллельности), запросы встают в очередь`,
        };
      }
      const prevP95 = prev.summary.p95;
      const p95Recovers = later.some((next) => prevP95 && next.p95 !== null && next.p95 <= prevP95 * 1.5);
      if (prevP95 && summary.p95 && summary.p95 > prevP95 * 2 && !p95Recovers) {
        return { concurrency, reason: `p95 вырос больше чем вдвое (${prevP95} → ${summary.p95} мс)` };
      }
    }
    bestRps = Math.max(bestRps, summary.rps);
  }
  return null;
}

/**
 * Таблица моноширинным текстом.
 * @param {string[]} header
 * @param {(string | number)[][]} rows
 */
export function formatTable(header, rows) {
  const cells = [header, ...rows.map((row) => row.map((cell) => String(cell)))];
  const widths = header.map((_, col) => Math.max(...cells.map((row) => row[col].length)));
  const line = (row) =>
    row.map((cell, col) => (col === row.length - 1 ? cell : cell.padEnd(widths[col]))).join("  ").trimEnd();
  return [line(cells[0]), widths.map((width) => "-".repeat(width)).join("  "), ...cells.slice(1).map(line)].join("\n");
}

/**
 * Коды ответов кратко: `200×950 500×3 timeout×1`.
 * @param {Record<string, number>} statuses
 */
export function formatStatuses(statuses) {
  return Object.entries(statuses)
    .sort((a, b) => b[1] - a[1])
    .map(([status, count]) => `${status}×${count}`)
    .join(" ");
}

/**
 * Взвешенный выбор: [{weight, ...}] и случайное число 0..1.
 * @template {{ weight: number }} T
 * @param {T[]} items
 * @param {number} random
 * @returns {T}
 */
export function pickWeighted(items, random) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let point = random * total;
  for (const item of items) {
    point -= item.weight;
    if (point < 0) return item;
  }
  return items[items.length - 1];
}
