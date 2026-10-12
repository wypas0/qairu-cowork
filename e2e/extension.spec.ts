import { readFileSync } from "node:fs";

import { type BrowserContext, type Page } from "@playwright/test";

import { expect, state, test } from "./fixtures";

/**
 * Сайт со стороны расширения кампуса. Само расширение в CI не ставится —
 * его ответы изображает скрипт страницы: на campus-ping отвечает campus-present
 * нужной версии и складывает присланные намерения в window.__intents.
 *
 * ack — что расширение отвечает на campus-intent с open: true: "opened" —
 * открыло кампус само (campus-intent-ok, opened: true), "refused" — не смогло
 * (opened: false), "slow" — сразу «campus-intent-opening», а opened: true только
 * через 2,5 с (медленный фон), "stuck" — «opening» и больше ничего; иначе молчит,
 * как расширение 0.4.0.
 */
function fakeExtension(version: string, ack?: "opened" | "refused" | "slow" | "stuck") {
  return `
    window.__intents = [];
    window.addEventListener("message", (event) => {
      const data = event.data || {};
      if (data.source !== "qairu-cowork") return;
      if (data.type === "campus-ping")
        window.postMessage({ source: "qairu-schedule-ext", type: "campus-present", version: ${JSON.stringify(version)}, change: null }, location.origin);
      if (data.type === "campus-intent") {
        window.__intents.push({ title: data.title, lang: data.lang, open: data.open });
        const ack = ${JSON.stringify(ack ?? null)};
        const reply = (extra) => window.postMessage({ source: "qairu-schedule-ext", ...extra }, location.origin);
        if (data.open && (ack === "slow" || ack === "stuck")) reply({ type: "campus-intent-opening" });
        if (data.open && ack === "slow") setTimeout(() => reply({ type: "campus-intent-ok", opened: true }), 2500);
        if (data.open && (ack === "opened" || ack === "refused")) reply({ type: "campus-intent-ok", opened: ack === "opened" });
      }
    });
  `;
}

/** Расширение, поставленное «потом»: на campus-ping молчит, пока тест не скажет window.__install(). */
const LATE_EXTENSION = `
  window.__installed = false;
  window.__pings = 0;
  window.addEventListener("message", (event) => {
    const data = event.data || {};
    if (data.source !== "qairu-cowork" || data.type !== "campus-ping") return;
    window.__pings += 1;
    if (window.__installed)
      window.postMessage({ source: "qairu-schedule-ext", type: "campus-present", version: "0.4.1", change: null }, location.origin);
  });
`;

const intents = (page: Page) => page.evaluate(() => (window as unknown as { __intents: unknown[] }).__intents);

/** Кампус из заглушки: настоящий не нужен, вкладке хватает пустой страницы. */
async function stubCampus(context: BrowserContext) {
  await context.route("https://campus.qairu.edu.kz/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<h1>campus</h1>" }),
  );
}

/** Сколько вкладок кампус открыл за время теста. */
function countPages(context: BrowserContext): { count: () => number } {
  let opened = 0;
  context.on("page", () => (opened += 1));
  return { count: () => opened };
}

/** Войти Болатом: у него ещё нет расписания, поэтому «Моё расписание» начинается с выбора. */
async function signInEmpty(context: BrowserContext) {
  const { tokenEmpty, url } = JSON.parse(readFileSync("e2e/.state.json", "utf8")) as { tokenEmpty: string; url: string };
  await context.clearCookies();
  await context.addCookies([{ name: "qairu_token", value: tokenEmpty, url, httpOnly: true }]);
}

test.describe("расширение кампуса", () => {
  test("0.4.0: «Перенести из кампуса» сообщает намерение и открывает кампус в окне qairu-campus", async ({ page, context }) => {
    await page.addInitScript(fakeExtension("0.4.0"));
    // Кампус настоящий не нужен: вкладке хватает заглушки.
    await stubCampus(context);
    await page.goto(`/g/${state().slug}/me`);
    const button = page.getByRole("link", { name: "Перенести из кампуса" });
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute("href", "https://campus.qairu.edu.kz/ru/schedule");
    await expect(button).toHaveAttribute("target", "qairu-campus");

    const [campus] = await Promise.all([context.waitForEvent("page"), button.click()]);
    await expect(campus).toHaveURL("https://campus.qairu.edu.kz/ru/schedule");
    expect(await intents(page)).toEqual([{ title: "ИС-21", lang: "ru" }]);
    await expect(page.getByText(/Кампус открылся в соседней вкладке/)).toBeVisible();
  });

  test("старое расширение: вместо кнопки — «обнови»", async ({ page }) => {
    await page.addInitScript(fakeExtension("0.3.0"));
    await page.goto(`/g/${state().slug}/me`);
    await expect(page.getByText("Вышла новая версия расширения для кампуса — обнови его.")).toBeVisible();
    // Кнопка ведёт к разделу «Обновление» и так и называется, а не «Как поставить».
    await expect(page.getByRole("link", { name: "Как обновить" })).toHaveAttribute("href", "/extension#update");
    await expect(page.getByRole("link", { name: "Перенести из кампуса" })).toHaveCount(0);
  });

  test("/extension: гайд по разделам и живая проверка", async ({ page }) => {
    await page.addInitScript(fakeExtension("0.4.1"));
    await page.goto("/extension");
    await expect(page.getByRole("heading", { name: "Расширение для кампуса", level: 1 })).toBeVisible();
    for (const title of ["Установка", "Как пользоваться", "Обновление", "Если что-то не так", "Приватность"]) {
      await expect(page.getByRole("heading", { name: title, level: 2 })).toBeVisible();
    }
    await expect(page.getByRole("status").filter({ hasText: "Установлено, версия 0.4.1" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Скачать, версия/ })).toHaveAttribute("download", "QairuCowork-extension.zip");
    await expect(page.locator(".ext-copy code")).toHaveText("chrome://extensions");
  });

  test("/extension без расширения: «не найдено»", async ({ page }) => {
    await page.goto("/extension");
    await expect(page.getByRole("status").filter({ hasText: "В этом браузере не найдено" })).toBeVisible({ timeout: 5000 });
  });

  test("пустое расписание: «Перенести из кампуса» сразу открывает кампус, дальше — сетка", async ({ page, context }) => {
    await signInEmpty(context);
    await page.addInitScript(fakeExtension("0.4.0"));
    await stubCampus(context);
    await page.goto(`/g/${state().slug}/me`);
    await expect(page.getByRole("heading", { name: "Как внести пары?" })).toBeVisible();
    // Загрузки файлов с расписанием больше нет.
    await expect(page.locator('input[type="file"]')).toHaveCount(0);

    const campusRow = page.locator('[data-choose="campus"]');
    await expect(campusRow).toHaveAttribute("href", "https://campus.qairu.edu.kz/ru/schedule");
    await expect(campusRow).toContainText("Откроется кампус");
    await expect(campusRow).toHaveAttribute("target", "qairu-campus");
    const [campus] = await Promise.all([context.waitForEvent("page"), campusRow.click()]);
    await expect(campus).toHaveURL("https://campus.qairu.edu.kz/ru/schedule");
    expect(await intents(page)).toEqual([{ title: "ИС-21", lang: "ru" }]);
    // Вернулся — сетка уже открыта, а подсказка вверху говорит, что кампус ждёт.
    await expect(page.locator(".editor-card table.week.editor:not(.day)")).toBeVisible();
    await expect(page.locator(".editor-card .ext-transfer")).toContainText("Кампус открылся в соседней вкладке");
  });

  test("пустое расписание без расширения: «из кампуса» ведёт к установке, «вручную» — к сетке", async ({ page, context }) => {
    await signInEmpty(context);
    await page.goto(`/g/${state().slug}/me`);
    const campusRow = page.locator('[data-choose="campus"]');
    await expect(campusRow).toHaveAttribute("href", "/extension");
    await expect(page.locator(".editor-card")).toHaveCount(0);
    await page.locator('[data-choose="manual"]').click();
    await expect(page.locator(".editor-card table.week.editor:not(.day)")).toBeVisible();
    await expect(page.locator(".editor-toolbar .brush")).toBeVisible();
    await expect(page.getByRole("button", { name: "Выбрать файлы" })).toHaveCount(0);
  });

  test("0.4.1: кампус открывает расширение — сайт не создаёт вкладку и шлёт open: true", async ({ page, context }) => {
    await page.addInitScript(fakeExtension("0.4.1", "opened"));
    await stubCampus(context);
    const pages = countPages(context);
    await page.goto(`/g/${state().slug}/me`);
    const button = page.getByRole("link", { name: "Перенести из кампуса" });
    await expect(button).toBeVisible();
    await button.click();
    await expect(page.getByText(/Кампус открылся в соседней вкладке/)).toBeVisible();
    // Дольше срока ожидания ответа: запасное открытие не должно сработать.
    await page.waitForTimeout(2500);
    expect(pages.count()).toBe(0);
    expect(await intents(page)).toEqual([{ title: "ИС-21", lang: "ru", open: true }]);
    await expect(page.getByText(/Кампус открылся в соседней вкладке/)).toBeVisible();
  });

  test("0.4.1 молчит в ответ: через 1,5 с кампус открывается в окне qairu-campus, повторно — в нём же", async ({
    page,
    context,
  }) => {
    await page.addInitScript(fakeExtension("0.4.1"));
    await stubCampus(context);
    const pages = countPages(context);
    await page.goto(`/g/${state().slug}/me`);
    const button = page.getByRole("link", { name: "Перенести из кампуса" });
    await expect(button).toBeVisible();

    const [campus] = await Promise.all([context.waitForEvent("page"), button.click()]);
    await expect(campus).toHaveURL("https://campus.qairu.edu.kz/ru/schedule");
    expect(await campus.evaluate(() => window.name)).toBe("qairu-campus");
    expect((await intents(page))[0]).toEqual({ title: "ИС-21", lang: "ru", open: true });

    await page.bringToFront();
    await button.click();
    await page.waitForTimeout(2500);
    expect(pages.count()).toBe(1);
    expect(await intents(page)).toHaveLength(2);
  });

  test("0.4.1 с медленным фоном: после «campus-intent-opening» сайт ждёт, второй вкладки нет", async ({ page, context }) => {
    await page.addInitScript(fakeExtension("0.4.1", "slow"));
    await stubCampus(context);
    const pages = countPages(context);
    await page.goto(`/g/${state().slug}/me`);
    await page.getByRole("link", { name: "Перенести из кампуса" }).click();
    // Ответ opened: true приходит через 2,5 с — позже обычных 1,5 с.
    await page.waitForTimeout(4500);
    expect(pages.count()).toBe(0);
  });

  test("0.4.1 сказало «открываю» и пропало: кампус всё же открывается сайтом, но только через 4 с", async ({
    page,
    context,
  }) => {
    await page.addInitScript(fakeExtension("0.4.1", "stuck"));
    await stubCampus(context);
    const pages = countPages(context);
    await page.goto(`/g/${state().slug}/me`);
    const started = Date.now();
    const [campus] = await Promise.all([
      context.waitForEvent("page", { timeout: 8000 }),
      page.getByRole("link", { name: "Перенести из кампуса" }).click(),
    ]);
    expect(Date.now() - started).toBeGreaterThan(3000);
    await expect(campus).toHaveURL("https://campus.qairu.edu.kz/ru/schedule");
    expect(pages.count()).toBe(1);
  });

  test("0.4.1 ответило opened: false: кампус открывается сайтом сразу", async ({ page, context }) => {
    await page.addInitScript(fakeExtension("0.4.1", "refused"));
    await stubCampus(context);
    await page.goto(`/g/${state().slug}/me`);
    const [campus] = await Promise.all([
      context.waitForEvent("page"),
      page.getByRole("link", { name: "Перенести из кампуса" }).click(),
    ]);
    await expect(campus).toHaveURL("https://campus.qairu.edu.kz/ru/schedule");
  });

  test("0.4.0: повторные нажатия берут ту же вкладку кампуса", async ({ page, context }) => {
    await page.addInitScript(fakeExtension("0.4.0"));
    await stubCampus(context);
    const pages = countPages(context);
    await page.goto(`/g/${state().slug}/me`);
    const button = page.getByRole("link", { name: "Перенести из кампуса" });
    await expect(button).toHaveAttribute("target", "qairu-campus");
    // Ссылка сама по себе (Ctrl+клик) — обычная внешняя, без window.opener.
    await expect(button).toHaveAttribute("rel", "noopener noreferrer");
    const [campus] = await Promise.all([context.waitForEvent("page"), button.click()]);
    expect(await campus.evaluate(() => window.name)).toBe("qairu-campus");
    await page.bringToFront();
    await button.click();
    await page.waitForTimeout(500);
    expect(pages.count()).toBe(1);
    // Старое расширение open не получает.
    expect(await intents(page)).toEqual([
      { title: "ИС-21", lang: "ru" },
      { title: "ИС-21", lang: "ru" },
    ]);
  });

  test("пустое расписание, 0.4.1: «из кампуса» не создаёт вкладку, сетка открывается", async ({ page, context }) => {
    await signInEmpty(context);
    await page.addInitScript(fakeExtension("0.4.1", "opened"));
    await stubCampus(context);
    const pages = countPages(context);
    await page.goto(`/g/${state().slug}/me`);
    await page.locator('[data-choose="campus"]').click();
    await expect(page.locator(".editor-card table.week.editor:not(.day)")).toBeVisible();
    await expect(page.locator(".editor-card .ext-transfer")).toContainText("Кампус открылся в соседней вкладке");
    // Страница не уезжает к сетке: подсказка «кампус открылся…» и кнопка остаются на виду.
    await expect(page.locator(".editor-card .ext-transfer")).toBeInViewport();
    await page.waitForTimeout(2500);
    expect(pages.count()).toBe(0);
    expect(await intents(page)).toEqual([{ title: "ИС-21", lang: "ru", open: true }]);
  });

  test("/extension: расширение поставили при открытой странице — статус сменяется сам, без перезагрузки", async ({ page }) => {
    await page.addInitScript(LATE_EXTENSION);
    await page.goto("/extension");
    const status = page.locator(".ext-status");
    await expect(status).toHaveAttribute("data-state", "absent", { timeout: 5000 });
    await expect(status).toContainText("не найдено");
    // Расширение внедрилось в открытую вкладку и само сообщило о себе.
    await page.evaluate(() =>
      window.postMessage({ source: "qairu-schedule-ext", type: "campus-present", version: "0.4.1", change: null }, location.origin),
    );
    await expect(status).toHaveAttribute("data-state", "present");
    await expect(status).toContainText("Установлено, версия 0.4.1");
  });

  test("/extension: расширение не прислало campus-present само — страница переспрашивает и находит его", async ({ page }) => {
    await page.addInitScript(LATE_EXTENSION);
    await page.goto("/extension");
    const status = page.locator(".ext-status");
    await expect(status).toHaveAttribute("data-state", "absent", { timeout: 5000 });
    const pings = () => page.evaluate(() => (window as unknown as { __pings: number }).__pings);
    const before = await pings();
    await page.evaluate(() => ((window as unknown as { __installed: boolean }).__installed = true));
    // ping повторяется раз в ~3 с, пока расширения нет.
    await expect(status).toHaveAttribute("data-state", "present", { timeout: 8000 });
    expect(await pings()).toBeGreaterThan(before);
    await expect(status).toContainText("Установлено, версия 0.4.1");
  });

  test("«Моё расписание»: расширение появилось позже — «поставь» сменяется на «Перенести из кампуса» без перезагрузки", async ({
    page,
    context,
  }) => {
    await signInEmpty(context);
    await page.addInitScript(LATE_EXTENSION);
    await page.goto(`/g/${state().slug}/me`);
    const campusRow = page.locator('[data-choose="campus"]');
    await expect(campusRow).toHaveAttribute("href", "/extension");
    await page.evaluate(() =>
      window.postMessage({ source: "qairu-schedule-ext", type: "campus-present", version: "0.4.1", change: null }, location.origin),
    );
    await expect(campusRow).toHaveAttribute("href", "https://campus.qairu.edu.kz/ru/schedule");
    await expect(campusRow).toHaveAttribute("target", "qairu-campus");
  });
});
