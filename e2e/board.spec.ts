import { expect, state, test } from "./fixtures";

const group = () => `/g/${state().slug}`;

test.describe("доска группы", () => {
  test("оживает: вкладки переключаются, подсказка у клетки — таблица «Свободны | Заняты»", async ({ page }) => {
    await page.goto(group());
    await expect(page.getByRole("heading", { name: "ИС-21", level: 1 })).toBeVisible();

    await page.getByRole("tab", { name: /Встречи/ }).click();
    await expect(page.locator("article.meeting", { hasText: "Созвон по проекту" })).toBeVisible();
    await page.getByRole("tab", { name: /Время/ }).click();

    await page.locator("table.week.periods td.cell").nth(20).hover();
    const tooltip = page.locator(".cell-tooltip");
    await expect(tooltip).toBeVisible();
    await expect(tooltip.locator(".who-table")).toContainText("Свободны");
    await expect(tooltip.locator(".who-table")).toContainText("Заняты");
  });

  test("протяжка мышью по дню ставит время в форму встречи", async ({ page }) => {
    await page.goto(group());
    // Следующая неделя целиком в будущем — день для протяжки есть всегда.
    await page.getByRole("button", { name: "Следующая неделя" }).click();
    await expect(page.getByRole("button", { name: "Эта неделя" })).toBeVisible();
    // Ждём, пока подъедут данные новой недели.
    await expect(page.locator(".heatmap")).toHaveAttribute("aria-busy", "false");

    const rows = page.locator("table.week.periods tbody tr:not(.break-row)");
    const from = (await rows.nth(0).locator("td.cell").nth(3).boundingBox())!;
    const to = (await rows.nth(2).locator("td.cell").nth(3).boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
    await page.mouse.up();

    // Форма встречи открылась во вкладке «Встречи» с выбранным временем,
    // а окно клетки по щелчку следом не всплыло.
    await expect(page.locator("#when-text")).toHaveValue(/·\s\d{2}:\d{2}–\d{2}:\d{2}/);
    await expect(page.locator(".cell-popover")).toHaveCount(0);
  });

  test("наведение на имя подсвечивает, когда человек свободен", async ({ page }) => {
    await page.goto(group());
    await page.locator(".who-list li", { hasText: "Ерлан" }).hover();
    await expect(page.locator("table.week.periods.spotting")).toBeVisible();
    // По вторникам и четвергам Ерлан занят с 12 до 15 — эти клетки гаснут.
    await expect(page.locator("td.cell.spot-off").first()).toBeVisible();
  });

  test("свёрнутая панель и закрытое «Лучшее время» запоминаются", async ({ page }) => {
    await page.goto(group());
    await page.getByRole("button", { name: "Свернуть панель" }).click();
    await expect(page.locator(".shell")).toHaveClass(/sidebar-closed/);
    await page.getByRole("button", { name: "Скрыть «Лучшее время»" }).click();
    await expect(page.locator(".best-collapsed")).toBeVisible();

    await page.reload();
    await expect(page.locator(".shell")).toHaveClass(/sidebar-closed/);
    await expect(page.locator(".best-collapsed")).toBeVisible();

    // Вернуть как было — чтобы не влиять на другие тесты.
    await page.getByRole("button", { name: "Развернуть панель" }).click();
    await page.locator(".best-collapsed").getByRole("button", { name: "Показать" }).click();
    await expect(page.locator(".shell")).not.toHaveClass(/sidebar-closed/);
  });

  test("в сайдбаре — все встречи группы с «через N» и ответами", async ({ page }) => {
    await page.goto(group());
    const current = page.locator(".sidebar-current");
    await expect(current.locator(".sidebar-meetings li")).toHaveCount(2);
    await expect(current.locator(".sidebar-soon")).toHaveText(/через \d+ (ч|мин)/);
    await expect(current).toContainText("2/5 идут");
    // Чужая группа свёрнута в одну строку.
    await expect(page.locator(".sidebar-item details.sidebar-fold")).not.toHaveAttribute("open");
  });
});

test.describe("встречи", () => {
  test("у прошедшей встречи есть итоги, «Повторить» заполняет форму", async ({ page }) => {
    await page.goto(group());
    await page.getByRole("tab", { name: /Встречи/ }).click();
    await page.locator("details.past-meetings > summary").click();
    const past = page.locator("article.meeting", { hasText: "Подготовка к защите" });
    await expect(past.locator(".summary-text")).toContainText("слайды — Асель");
    await past.getByRole("button", { name: "Повторить" }).click();
    await expect(page.locator("#goal")).toHaveValue("Подготовка к защите");
    await expect(page.locator("#place")).toHaveValue("Аудитория 305");
    await expect(page.locator("#when-text")).toHaveValue(/15:00–16:30/);
  });
});

test.describe("моё расписание", () => {
  test("кисть «Неудобно» красит и сохраняется", async ({ page }) => {
    await page.goto(`${group()}/me`);
    await page.getByRole("radio", { name: "Неудобно" }).click();
    const cell = page.locator('td.cell[data-key="2:480"]');
    await cell.click();
    await expect(cell).toHaveClass(/soft/);
    await expect(page.locator(".savestate")).toContainText("Сохранено");

    await page.reload();
    await expect(page.locator('td.cell[data-key="2:480"]')).toHaveClass(/soft/);
    // Вернуть как было.
    await page.getByRole("radio", { name: "Неудобно" }).click();
    await page.locator('td.cell[data-key="2:480"]').click();
    await expect(page.locator('td.cell[data-key="2:480"]')).not.toHaveClass(/soft/);
    await expect(page.locator(".savestate")).toContainText("Сохранено");
  });
});

test.describe("телефон", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("карта — один день крупными строками, дни переключаются", async ({ page }) => {
    await page.goto(group());
    await expect(page.locator(".heatmap table.week")).toBeHidden();
    const agenda = page.locator(".agenda");
    await expect(agenda).toBeVisible();
    await expect(agenda.locator(".agenda-row").first()).toBeVisible();

    const chips = page.locator(".heat-days .daychip");
    await chips.nth(6).click();
    await expect(chips.nth(6)).toHaveAttribute("aria-selected", "true");
    // Воскресенье: Дана работает с 20 до 22 — «нет: Дана» в вечерних строках.
    await expect(agenda).toContainText("нет: Дана");
  });
});

test.describe("приглашение и установка", () => {
  test("QR на весь экран, манифест и иконки на месте", async ({ page, request }) => {
    await page.goto(`${group()}/qr`);
    await expect(page.locator("svg.qr")).toBeVisible();
    await expect(page.getByText("SMOK E001")).toBeVisible();

    const manifest = await request.get("/manifest.webmanifest");
    expect((await manifest.json()).name).toBe("QairuCowork");
    const icon = await request.get("/icon-192.png");
    expect(icon.headers()["content-type"]).toContain("image/png");
    const botAvatar = await request.get("/bot-avatar.png");
    expect(botAvatar.headers()["content-type"]).toContain("image/png");
  });
});
