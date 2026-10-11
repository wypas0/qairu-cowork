import { readFileSync } from "node:fs";

import { type BrowserContext } from "@playwright/test";

import { expect, state, test } from "./fixtures";

/**
 * Сайт со стороны расширения кампуса. Само расширение в CI не ставится —
 * его ответы изображает скрипт страницы: на campus-ping отвечает campus-present
 * нужной версии и складывает присланные намерения в window.__intents.
 */
function fakeExtension(version: string) {
  return `
    window.__intents = [];
    window.addEventListener("message", (event) => {
      const data = event.data || {};
      if (data.source !== "qairu-cowork") return;
      if (data.type === "campus-ping")
        window.postMessage({ source: "qairu-schedule-ext", type: "campus-present", version: ${JSON.stringify(version)}, change: null }, location.origin);
      if (data.type === "campus-intent") window.__intents.push({ title: data.title, lang: data.lang });
    });
  `;
}

/** Войти Болатом: у него ещё нет расписания, поэтому «Моё расписание» начинается с выбора. */
async function signInEmpty(context: BrowserContext) {
  const { tokenEmpty, url } = JSON.parse(readFileSync("e2e/.state.json", "utf8")) as { tokenEmpty: string; url: string };
  await context.clearCookies();
  await context.addCookies([{ name: "qairu_token", value: tokenEmpty, url, httpOnly: true }]);
}

test.describe("расширение кампуса", () => {
  test("«Перенести из кампуса»: сообщает намерение и открывает кампус в новой вкладке", async ({ page, context }) => {
    await page.addInitScript(fakeExtension("0.4.0"));
    // Кампус настоящий не нужен: вкладке хватает заглушки.
    await context.route("https://campus.qairu.edu.kz/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<h1>campus</h1>" }),
    );
    await page.goto(`/g/${state().slug}/me`);
    const button = page.getByRole("link", { name: "Перенести из кампуса" });
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute("href", "https://campus.qairu.edu.kz/ru/schedule");

    const [campus] = await Promise.all([context.waitForEvent("page"), button.click()]);
    await expect(campus).toHaveURL("https://campus.qairu.edu.kz/ru/schedule");
    expect(await page.evaluate(() => (window as unknown as { __intents: unknown[] }).__intents)).toEqual([
      { title: "ИС-21", lang: "ru" },
    ]);
    await expect(page.getByText(/Кампус открылся в новой вкладке/)).toBeVisible();
  });

  test("старое расширение: вместо кнопки — «обнови»", async ({ page }) => {
    await page.addInitScript(fakeExtension("0.3.0"));
    await page.goto(`/g/${state().slug}/me`);
    await expect(page.getByText("Вышла новая версия расширения для кампуса — обнови его.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Перенести из кампуса" })).toHaveCount(0);
  });

  test("/extension: гайд по разделам и живая проверка", async ({ page }) => {
    await page.addInitScript(fakeExtension("0.4.0"));
    await page.goto("/extension");
    await expect(page.getByRole("heading", { name: "Расширение для кампуса", level: 1 })).toBeVisible();
    for (const title of ["Установка", "Как пользоваться", "Обновление", "Если что-то не так", "Приватность"]) {
      await expect(page.getByRole("heading", { name: title, level: 2 })).toBeVisible();
    }
    await expect(page.getByRole("status").filter({ hasText: "Установлено, версия 0.4.0" })).toBeVisible();
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
    await context.route("https://campus.qairu.edu.kz/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<h1>campus</h1>" }),
    );
    await page.goto(`/g/${state().slug}/me`);
    await expect(page.getByRole("heading", { name: "Как внести пары?" })).toBeVisible();
    // Загрузки файлов с расписанием больше нет.
    await expect(page.locator('input[type="file"]')).toHaveCount(0);

    const campusRow = page.locator('[data-choose="campus"]');
    await expect(campusRow).toHaveAttribute("href", "https://campus.qairu.edu.kz/ru/schedule");
    await expect(campusRow).toContainText("Откроется кампус");
    const [campus] = await Promise.all([context.waitForEvent("page"), campusRow.click()]);
    await expect(campus).toHaveURL("https://campus.qairu.edu.kz/ru/schedule");
    expect(await page.evaluate(() => (window as unknown as { __intents: unknown[] }).__intents)).toEqual([
      { title: "ИС-21", lang: "ru" },
    ]);
    // Вернулся — сетка уже открыта, а подсказка вверху говорит, что кампус ждёт.
    await expect(page.locator(".editor-card table.week.editor:not(.day)")).toBeVisible();
    await expect(page.locator(".editor-card .ext-transfer")).toContainText("Кампус открылся в новой вкладке");
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
});
