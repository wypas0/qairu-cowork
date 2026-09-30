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
    // Ждём сам ответ с данными новой недели: aria-busy="false" верно и до
    // того, как запрос ушёл (он уходит после паузы), — тест протягивал по
    // старой сетке, и она перерисовывалась прямо под мышью.
    const loaded = page.waitForResponse((response) => /\/api\/g\/[^/]+\/state\?.*week=1/.test(response.url()));
    await page.getByRole("button", { name: "Следующая неделя" }).click();
    await expect(page.getByRole("button", { name: "Эта неделя" })).toBeVisible();
    await loaded;
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

  test("перерыв — сплошная полоса; нажатие в столбце дня назначает встречу на перерыв", async ({ page }) => {
    await page.goto(group());
    const loaded = page.waitForResponse((response) => /\/api\/g\/[^/]+\/state\?.*week=1/.test(response.url()));
    await page.getByRole("button", { name: "Следующая неделя" }).click();
    await loaded;
    await expect(page.locator(".heatmap")).toHaveAttribute("aria-busy", "false");

    // Встреч на перерыве нет — ряд одной ячейкой через всю неделю.
    const strip = page.locator("table.week.periods tr.pause-row").first().locator("td");
    await expect(strip).toHaveCount(1);
    await expect(strip).toHaveText("Перерыв 20 мин");

    const thursday = (await page.locator("table.week.periods thead th").nth(4).boundingBox())!;
    const box = (await strip.boundingBox())!;
    await page.mouse.click(thursday.x + thursday.width / 2, box.y + box.height / 2);
    const popover = page.locator(".cell-popover");
    await expect(popover).toContainText("10:50–11:10");
    await popover.getByRole("button", { name: "Назначить" }).click();
    await expect(page.locator("#when-text")).toHaveValue(/четверг.*10:50–11:10/);

    // Продлили встречу в поле, не трогая день, — точное время пересчиталось,
    // встреча останется на карте, а не уйдёт простым текстом.
    const when = page.locator("#when-text");
    await when.fill((await when.inputValue()).replace("11:10", "13:00"));
    await expect(page.locator('input[name="when"]')).toHaveValue(/T10:50\|130$/);
    await when.fill("в четверг после пар");
    await expect(page.locator('input[name="when"]')).toHaveValue("в четверг после пар");
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

    // Превью ссылки-приглашения в мессенджере: робот приходит без входа.
    const invite = await (await request.get(`${group()}/join`)).text();
    expect(invite).toContain('property="og:title" content="Присоединиться к группе «ИС-21»"');
    expect(invite).toContain('property="og:image"');
    const preview = await request.get("/opengraph-image");
    expect(preview.headers()["content-type"]).toContain("image/png");
  });
});

test.describe("вступление по ссылке", () => {
  test("открытая самим ссылка вступает сразу, переход с чужого сайта — только по кнопке", async ({ page }) => {
    const { url } = state();

    // Открыл сам (из приложения, по QR, из закладки) — сразу в группе.
    const direct = await page.goto("/g/smoke004/join");
    await expect(page).toHaveURL(/\/g\/smoke004(\/welcome|\/me)?(\?|$)/);
    expect(direct?.headers()["content-security-policy"]).toContain("frame-ancestors 'self' https://*.telegram.org");

    // Ссылка на чужой странице: 127.0.0.1 для браузера — другой сайт, чем localhost.
    await page.goto(`${url.replace("localhost", "127.0.0.1")}/api/healthz`);
    await page.setContent(`<a href="${url}/g/smoke003/join">приглашение</a>`);
    await page.getByRole("link", { name: "приглашение" }).click();
    const confirm = page.getByRole("button", { name: "Присоединиться" });
    await expect(confirm).toBeVisible();
    await confirm.click();
    await expect(page).toHaveURL(/\/g\/smoke003(\/welcome|\/me)?(\?|$)/);
  });
});

test.describe("мини-апп", () => {
  test("приглашение ?startapp=<код> открывает эту группу и вступает, а не последнюю", async ({ page }) => {
    // Настоящий скрипт Telegram не нужен: подставляем мини-апп с кодом приглашения.
    await page.route("https://telegram.org/**", (route) => route.abort());
    await page.addInitScript(() => {
      window.Telegram = {
        WebApp: { initData: "query_id=e2e", initDataUnsafe: { start_param: "smoke005" }, ready() {}, expand() {} },
      };
    });
    await page.goto("/");
    await expect(page).toHaveURL(/\/g\/smoke005(\/welcome|\/me)?(\?|$)/);
  });
});

test.describe("мини-апп: разрешение писать", () => {
  test("без разрешения — предложение; после «Разрешить» оно исчезает", async ({ page }) => {
    await page.route("https://telegram.org/**", (route) => route.abort());
    await page.addInitScript(() => {
      window.Telegram = {
        WebApp: {
          initData: "query_id=e2e",
          initDataUnsafe: { user: { allows_write_to_pm: false } },
          ready() {},
          expand() {},
          requestWriteAccess(callback) {
            callback?.(true);
          },
        },
      };
    });
    await page.goto(group());
    const prompt = page.getByText("Разреши боту писать тебе");
    await expect(prompt).toBeVisible();
    await page.getByRole("button", { name: "Разрешить" }).click();
    await expect(prompt).toBeHidden();
  });
});

test.describe("редактор на телефоне", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test("один день крупными клетками: выбор дня, отметка сохраняется", async ({ page }) => {
    await page.goto(`${group()}/me`);
    // Неделя в семь колонок на 375px не показывается — вместо неё дневной вид.
    await expect(page.locator(".gridwrap > table.week.editor:not(.day)")).toBeHidden();
    await expect(page.locator(".editor-day")).toBeVisible();

    await page.getByRole("tab", { name: "Четверг" }).click();
    const cell = page.locator('td.cell[data-day-key="3:540"]');
    // Цель нажатия — не меньше 44px с обеих сторон.
    const box = (await cell.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);

    await cell.tap();
    await expect(cell).toHaveClass(/busy/);
    await expect(cell).toContainText("занят");
    await expect(page.locator(".savestate")).toContainText("Сохранено");
    // Счётчик занятых пар у дня.
    await expect(page.getByRole("tab", { name: "Четверг" })).toContainText("1");

    await page.reload();
    await page.getByRole("tab", { name: "Четверг" }).click();
    await expect(page.locator('td.cell[data-day-key="3:540"]')).toHaveClass(/busy/);
    // Вернуть как было.
    await page.locator('td.cell[data-day-key="3:540"]').tap();
    await expect(page.locator('td.cell[data-day-key="3:540"]')).not.toHaveClass(/busy/);
    await expect(page.locator(".savestate")).toContainText("Сохранено");
  });
});

test.describe("клавиатура", () => {
  test("стрелки ходят по клеткам карты группы", async ({ page }) => {
    await page.goto(group());
    const cells = page.locator(".heatmap table.week.periods td.cell");
    await cells.nth(0).focus();
    await page.keyboard.press("ArrowRight");
    await expect(cells.nth(1)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    // В ряду семь дней: вниз — та же колонка следующего ряда.
    await expect(cells.nth(8)).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    // На краю фокус стоит на месте.
    await expect(cells.nth(7)).toBeFocused();
  });

  test("стрелки ходят по клеткам редактора и перешагивают перерыв", async ({ page }) => {
    await page.goto(`${group()}/me`);
    const at = (key: string) => page.locator(`td.cell[data-key="${key}"]`);
    await at("0:480").focus();
    await page.keyboard.press("ArrowDown");
    await expect(at("0:540")).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(at("1:540")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    // После 3-й пары перерыв 20 минут — отдельной строкой, стрелка её пропускает.
    await page.keyboard.press("ArrowDown");
    await expect(at("1:670")).toBeFocused();
    // Стрелки ничего не красят.
    await expect(page.locator("td.cell.busy[data-key^='1:']")).toHaveCount(0);
  });
});

test.describe("состояния", () => {
  test("пока окна пересчитываются, карточка показывает загрузку", async ({ page }) => {
    await page.goto(group());
    await page.route("**/api/g/*/state**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });
    await page.locator(".windows-card select").selectOption({ index: 2 });
    const card = page.locator(".windows-card");
    await expect(card).toHaveAttribute("aria-busy", "true");
    // Бегущая полоса — псевдоэлемент поверх карточки.
    const bar = await card.evaluate((element) => getComputedStyle(element, "::before").content);
    expect(bar).not.toBe("none");
    await expect(card).toHaveAttribute("aria-busy", "false");
  });

  test("мини-апп: «Готово» — цветом главной кнопки сайта, контраст AA", async ({ page }) => {
    await page.route("https://telegram.org/**", (route) => route.abort());
    await page.addInitScript(() => {
      const params: Record<string, unknown>[] = [];
      (window as unknown as { __mainParams: typeof params }).__mainParams = params;
      const button = {
        setParams(next: Record<string, unknown>) {
          params.push(next);
          return button;
        },
        setText() {
          return button;
        },
        show() {
          return button;
        },
        hide() {
          return button;
        },
        onClick() {
          return button;
        },
        offClick() {
          return button;
        },
        showProgress() {
          return button;
        },
        hideProgress() {
          return button;
        },
      };
      window.Telegram = {
        WebApp: {
          initData: "query_id=e2e",
          initDataUnsafe: { user: { allows_write_to_pm: true } },
          colorScheme: "dark",
          ready() {},
          expand() {},
          MainButton: button,
        } as never,
      };
    });
    await page.goto(`${group()}/me`);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __mainParams: { color?: string }[] }).__mainParams.at(-1)?.color))
      .toBe("#ffffff");
    const last = await page.evaluate(
      () => (window as unknown as { __mainParams: { text_color?: string }[] }).__mainParams.at(-1)?.text_color,
    );
    expect(last).toBe("#1b1b1b");
  });
});

test.describe("без скачков", () => {
  test("доска группы грузится без сдвигов макета", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __cls: number }).__cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
          if (!entry.hadRecentInput) (window as unknown as { __cls: number }).__cls += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto(group(), { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    // Раньше прошедшее сегодня окно исчезало из «Лучшего времени» после
    // загрузки, и всё ниже прыгало вверх: 0,026 вечером.
    expect(await page.evaluate(() => (window as unknown as { __cls: number }).__cls)).toBeLessThan(0.005);
  });
});

test.describe("витрина лендинга", () => {
  test("шрифты витрины включаются после загрузки, небо грузится заранее", async ({ page }) => {
    // Витрину видит только гость.
    await page.context().clearCookies();
    await page.goto("/");
    await expect(page.locator("html")).toHaveClass(/deco-fonts/);
    const family = await page.locator(".hero .script-word").evaluate((element) => getComputedStyle(element).fontFamily);
    expect(family).toMatch(/Caveat/);
    await expect(page.locator('head link[rel="preload"][href="/hero-sky.jpg"]')).toHaveCount(1);
    await expect(page.locator(".manifest")).toBeVisible();
  });
});
