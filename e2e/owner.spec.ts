import { readFileSync } from "node:fs";

import { expect, test } from "./fixtures";

/** Токены из e2e-server: Амир — владелец, Болат — нет; ownerToken — открытая сессия консоли Амира. */
function tokens(): { token: string; tokenEmpty: string; ownerToken: string; ownerCode: string; url: string } {
  return JSON.parse(readFileSync("e2e/.state.json", "utf8"));
}

/** Все адреса консоли: вкладки и карточки (Асель — 1002, группа «ИС-21»). */
const GROUP_ID = String(-(10 ** 15) - 111);
const ADMIN_PATHS = [
  "/admin",
  "/admin/stats",
  "/admin/users",
  "/admin/users?q=Асель",
  "/admin/users/1002",
  "/admin/groups",
  `/admin/groups/${GROUP_ID}`,
  "/admin/system",
];

function ownerCookie(ownerToken: string, url: string) {
  return { name: "qairu_owner", value: ownerToken, url: `${url}/admin`, httpOnly: true, sameSite: "Strict" as const };
}

test.describe("консоль владельца", () => {
  test("не владельцу — «не найдено», как будто адреса нет", async ({ page, context }) => {
    const { tokenEmpty, url } = tokens();
    await context.clearCookies();
    await context.addCookies([{ name: "qairu_token", value: tokenEmpty, url, httpOnly: true }]);
    for (const path of ADMIN_PATHS) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
      await expect(page.getByRole("button", { name: "Прислать код" })).toHaveCount(0);
      await expect(page.getByText("Асель")).toHaveCount(0);
    }
    // Без входа вовсе — тоже 404, а не переход на страницу входа.
    await context.clearCookies();
    for (const path of ADMIN_PATHS) expect((await page.goto(path))?.status(), path).toBe(404);
  });

  test("владелец без сессии консоли входит только кодом: неверный — тост, верный — консоль", async ({ page }) => {
    const { ownerCode } = tokens();
    const response = await page.goto("/admin");
    expect(response?.status()).toBe(200);
    expect(response?.headers()["cache-control"]).toContain("no-store");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.getByRole("heading", { name: "Подтверди вход" })).toBeVisible();
    await expect(page.getByText("Регистрации по дням")).toHaveCount(0);
    // Бота в e2e нет — новый код не запросить, рядом объяснение.
    await expect(page.getByRole("button", { name: "Прислать новый код" })).toBeDisabled();
    await expect(page.getByText("Бот не настроен")).toBeVisible();

    const field = page.getByLabel("Код из Telegram");
    await field.fill(ownerCode === "000000" ? "111111" : "000000");
    await page.getByRole("button", { name: "Войти" }).click();
    await expect(page.locator(".toast")).toContainText("Неверный код. Осталось попыток: 4");
    await expect(page).toHaveURL(/\/admin$/);

    await page.getByLabel("Код из Telegram").fill(ownerCode);
    await page.getByRole("button", { name: "Войти" }).click();
    await expect(page.getByRole("heading", { name: "Регистрации по дням" })).toBeVisible();
    const cookie = (await page.context().cookies()).find((item) => item.name === "qairu_owner");
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Strict", path: "/admin" });
    // Код одноразовый: после входа поля для него нет.
    await expect(page.getByLabel("Код из Telegram")).toHaveCount(0);
  });

  test("владелец без сессии консоли на любой вкладке видит только ввод кода", async ({ page }) => {
    for (const path of ["/admin/users", "/admin/users/1002", `/admin/groups/${GROUP_ID}`, "/admin/system"]) {
      expect((await page.goto(path))?.status(), path).toBe(200);
      await expect(page.getByRole("heading", { name: "Подтверди вход" })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Разделы консоли" })).toHaveCount(0);
      await expect(page.getByText("Асель")).toHaveCount(0);
    }
  });

  test("пользователи: список, фильтр, поиск, карточка; группы; просмотр — в журнале", async ({ page, context }) => {
    const { ownerToken, url } = tokens();
    await context.addCookies([ownerCookie(ownerToken, url)]);

    await page.goto("/admin");
    const tabs = page.getByRole("navigation", { name: "Разделы консоли" });
    await expect(tabs.getByRole("link", { name: "Обзор" })).toHaveAttribute("aria-current", "page");
    await tabs.getByRole("link", { name: "Пользователи" }).click();
    await expect(page).toHaveURL(/\/admin\/users$/);
    const rows = page.locator(".owner-rows tbody tr");
    await expect(rows).toHaveCount(5);
    await expect(page.getByText("Найдено: 5")).toBeVisible();

    // Фильтр «Без расписания» — только Болат.
    await page.getByRole("link", { name: /Без расписания/ }).click();
    await expect(page).toHaveURL(/filter=unfilled/);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Болат");
    await expect(rows.first()).toContainText("не заполнено");

    // Поиск сохраняет фильтр; «Все» — все, кто подходит под поиск.
    await page.getByRole("link", { name: /^Все/ }).click();
    await expect(page).not.toHaveURL(/filter=/);
    await page.getByRole("searchbox").fill("Асель");
    await page.getByRole("button", { name: "Найти" }).click();
    await expect(page).toHaveURL(/q=/);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("1002");
    await rows.first().getByRole("link", { name: "Асель" }).click();

    await expect(page).toHaveURL(/\/admin\/users\/1002$/);
    await expect(page.getByRole("heading", { name: "Асель" })).toBeVisible();
    const groupsTable = page.locator(".owner-rows");
    await expect(groupsTable.getByRole("link", { name: "Дипломники" })).toBeVisible();
    await expect(groupsTable.getByRole("row", { name: /Хор/ })).toContainText("староста");
    await expect(page.getByText(/Не показываются: токены/)).toBeVisible();
    // Ни хешей, ни токенов на странице.
    expect(await page.content()).not.toMatch(/[0-9a-f]{64}/);

    // Группа из карточки → участники со ссылками на людей.
    await groupsTable.getByRole("link", { name: "ИС-21" }).click();
    await expect(page.getByRole("heading", { name: "ИС-21" })).toBeVisible();
    await expect(page.locator(".owner-rows tbody tr")).toHaveCount(5);
    await page.getByRole("link", { name: "Все группы" }).click();
    await expect(page.locator(".owner-rows tbody tr")).toHaveCount(5);
    // Число на фильтре совпадает со строками (другие e2e вступают в группы, точное число не фиксируем).
    const live = page.getByRole("link", { name: /^Живые/ });
    const liveCount = Number(await live.locator(".owner-chip-count").textContent());
    expect(liveCount).toBeGreaterThanOrEqual(2);
    await live.click();
    await expect(page).toHaveURL(/filter=live/);
    await expect(page.locator(".owner-rows tbody tr")).toHaveCount(liveCount);
    await expect(page.locator(".owner-rows tbody")).toContainText("ИС-21");

    // Журнал просмотров на вкладке «Система».
    await page.getByRole("navigation", { name: "Разделы консоли" }).getByRole("link", { name: "Система" }).click();
    const views = page.locator(".owner-views li");
    await expect(views.first()).toContainText("карточка группы: ИС-21");
    await expect(views.nth(1)).toContainText("карточка человека: Асель");

    // Несуществующая карточка — 404.
    expect((await page.goto("/admin/users/999999"))?.status()).toBe(404);
  });

  test("на ширине телефона список — карточками, без горизонтальной прокрутки", async ({ page, context }) => {
    const { ownerToken, url } = tokens();
    await context.addCookies([ownerCookie(ownerToken, url)]);
    await page.setViewportSize({ width: 390, height: 844 });
    for (const path of ["/admin", "/admin/users", "/admin/users/1001", "/admin/groups", `/admin/groups/${GROUP_ID}`, "/admin/system"]) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
    await page.goto("/admin/users");
    // Заголовки таблицы спрятаны, у каждой ячейки своя подпись.
    await expect(page.locator(".owner-rows thead th").first()).toHaveCSS("display", "block");
    const cell = page.locator('.owner-rows tbody tr td[data-label="Язык"]').first();
    await expect(cell).toHaveCSS("display", "flex");
  });

  test("с сессией консоли — метрики; «Система»; выход отзывает сессию на сервере", async ({ page, context }) => {
    const { ownerToken, url } = tokens();
    await context.addCookies([ownerCookie(ownerToken, url)]);

    await page.goto("/admin/stats");
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "Регистрации по дням" })).toBeVisible();
    await expect(page.locator(".owner-signups svg rect.owner-bar-hit")).toHaveCount(90);
    await expect(page.locator(".owner-kpi")).toHaveCount(5);
    for (const heading of [
      "Воронка активации",
      "Удержание по неделям",
      "Новые группы по дням",
      "Самые активные группы за 30 дней",
      "Функции",
      "Языки",
      "Охват бота",
    ]) {
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }

    await page.goto("/admin/system");
    await expect(page.getByRole("heading", { name: "Хранилище" })).toBeVisible();
    await expect(page.locator(".owner-table").getByRole("cell", { name: "owner_sessions" })).toBeVisible();
    // Журнал входов: свежий вход сверху (засеянный или из теста с кодом), адрес — меткой хеша.
    const logins = page.locator(".owner-events:not(.owner-views) li");
    await expect(logins.first()).toContainText("вход");
    await expect(logins.first()).toContainText(/#[0-9a-f]{8}/);
    await expect(page.getByText("8 / 9 · 89%")).toBeVisible();

    // Выход с вкладки возвращает на неё же — уже с формой кода.
    await page.getByRole("button", { name: "Выйти из консоли" }).click();
    await expect(page).toHaveURL(/\/admin\/system/);
    await expect(page.getByRole("heading", { name: "Подтверди вход" })).toBeVisible();

    // Та же кука после выхода больше не пускает.
    await context.addCookies([ownerCookie(ownerToken, url)]);
    await page.goto("/admin/users");
    await expect(page.getByRole("heading", { name: "Подтверди вход" })).toBeVisible();
  });
});
