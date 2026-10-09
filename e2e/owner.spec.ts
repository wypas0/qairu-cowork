import { readFileSync } from "node:fs";

import { expect, test } from "./fixtures";

/** Токены из e2e-server: Амир — владелец, Болат — нет; ownerToken — открытая сессия консоли Амира. */
function tokens(): { token: string; tokenEmpty: string; ownerToken: string; ownerCode: string; url: string } {
  return JSON.parse(readFileSync("e2e/.state.json", "utf8"));
}

test.describe("консоль владельца", () => {
  test("не владельцу — «не найдено», как будто адреса нет", async ({ page, context }) => {
    const { tokenEmpty, url } = tokens();
    await context.clearCookies();
    await context.addCookies([{ name: "qairu_token", value: tokenEmpty, url, httpOnly: true }]);
    for (const path of ["/admin", "/admin/stats"]) {
      const response = await page.goto(path);
      expect(response?.status()).toBe(404);
      await expect(page.getByRole("button", { name: "Прислать код" })).toHaveCount(0);
    }
    // Без входа вовсе — тоже 404, а не переход на страницу входа.
    await context.clearCookies();
    expect((await page.goto("/admin"))?.status()).toBe(404);
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

  test("с сессией консоли — метрики; выход отзывает сессию на сервере", async ({ page, context }) => {
    const { ownerToken, url } = tokens();
    await context.addCookies([{ name: "qairu_owner", value: ownerToken, url: `${url}/admin`, httpOnly: true, sameSite: "Strict" }]);

    await page.goto("/admin/stats");
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "Регистрации по дням" })).toBeVisible();
    await expect(page.locator(".owner-chart svg rect.owner-bar-hit")).toHaveCount(90);
    await expect(page.locator(".owner-kpi")).toHaveCount(5);
    await expect(page.getByRole("heading", { name: "Хранилище" })).toBeVisible();
    await expect(page.locator(".owner-table").getByRole("cell", { name: "owner_sessions" })).toBeVisible();
    // Журнал: свежий вход сверху (засеянный или из теста с кодом), адрес — меткой хеша.
    await expect(page.locator(".owner-events li").first()).toContainText("вход");
    await expect(page.locator(".owner-events li").first()).toContainText(/#[0-9a-f]{8}/);
    await expect(page.getByText("8 / 9 · 89%")).toBeVisible();

    await page.getByRole("button", { name: "Выйти из консоли" }).click();
    await expect(page.getByRole("heading", { name: "Подтверди вход" })).toBeVisible();

    // Та же кука после выхода больше не пускает.
    await context.addCookies([{ name: "qairu_owner", value: ownerToken, url: `${url}/admin`, httpOnly: true, sameSite: "Strict" }]);
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Подтверди вход" })).toBeVisible();
  });
});
