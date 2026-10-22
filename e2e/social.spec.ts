import type { BrowserContext, Page } from "@playwright/test";

import { expect, state, test } from "./fixtures";

/*
 * Друзья — сквозной сценарий двух людей: Амир и Асель (вход — кукой из
 * e2e/.state.json). Файл идёт последним по алфавиту, после консоли владельца:
 * её тесты считают группы и участников, а здесь создаются новые группы и
 * люди в них вступают. Группы засеянной базы не годятся: тесты доски уже
 * ввели Амира во все группы Асель.
 */

const AMIR = 1001;
const ASEL = 1002;

async function as(context: BrowserContext, who: "amir" | "asel") {
  const { token, tokenAsel, url } = state();
  await context.addCookies([{ name: "qairu_token", value: who === "amir" ? token : tokenAsel, url, httpOnly: true }]);
}

/** Новая группа текущего человека через окно «Создать группу». */
async function createGroup(page: Page, title: string) {
  await page.goto("/#create");
  const dialog = page.locator(".create-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Название группы").fill(title);
  await dialog.getByRole("button", { name: "Создать группу" }).click();
  await expect(page).toHaveURL(/\/g\/[a-z0-9]+\/me/);
}

test.describe("друзья", () => {
  test.describe.configure({ mode: "serial" });

  test("заявка по нику: у Асель точка на профиле; отказ можно вернуть, потом она принимает", async ({ page, context }) => {
    await page.goto("/friends?tab=add");
    await page.getByPlaceholder("@ник в Telegram").fill("@asel_n");
    await page.getByRole("button", { name: "Найти" }).click();
    await expect(page.locator(".fr-found")).toContainText("Асель");
    await page.locator(".fr-found").getByRole("button", { name: "Добавить в друзья" }).click();
    await expect(page.locator(".toast")).toContainText("Заявка отправлена");
    await page.getByRole("tab", { name: /^Заявки/ }).click();
    await expect(page.locator("#panel-requests")).toContainText("Асель");

    await as(context, "asel");
    await page.goto("/friends");
    // Есть что ответить — раздел открывается сразу на заявках, на кнопке профиля точка.
    await expect(page.getByRole("tab", { name: /^Заявки/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".icon-btn .pp-dot").first()).toBeAttached();
    const requests = page.locator("section", { hasText: "Хотят дружить" });
    // Отказ — без окна «Ты уверен?», зато с «Вернуть» в тосте.
    await requests.locator(".fr-row", { hasText: "Амир" }).getByRole("button", { name: "Отклонить" }).click();
    await expect(page.locator(".toast")).toContainText("Отклонено");
    await page.locator(".toast").getByRole("button", { name: "Вернуть" }).click();
    await expect(page.locator(".toast")).toContainText("Вернули");
    await requests.locator(".fr-row", { hasText: "Амир" }).getByRole("button", { name: "Принять" }).click();
    await expect(page.locator(".toast")).toContainText("теперь вы друзья");
    await page.getByRole("tab", { name: "Друзья" }).click();
    await expect(page.locator("#panel-friends")).toContainText("Амир");
  });

  test("Асель скрывает «Шахматы» и зовёт Амира в «Литклуб»", async ({ page, context }) => {
    await as(context, "asel");
    for (const title of ["Литклуб", "Кино", "Шахматы"]) await createGroup(page, title);
    await page.goto("/friends?tab=privacy");
    const save = page.getByRole("button", { name: "Сохранить" });
    // Сохранять нечего, пока ничего не изменено.
    await expect(save).toBeDisabled();
    await page.locator(".fr-visible").getByRole("switch", { name: "Шахматы" }).uncheck();
    await save.click();
    await expect(page.locator(".toast")).toContainText("Сохранено");
    await expect(page.locator(".fr-visible").getByRole("switch", { name: "Шахматы" })).not.toBeChecked();

    // «Позвать в группу» в шапке карточки — сразу список групп.
    await page.goto(`/friends/${AMIR}`);
    await page.getByRole("button", { name: "Позвать в группу" }).click();
    await page.locator(".menu-panel").getByRole("button", { name: "Литклуб" }).click();
    await expect(page.locator(".toast")).toContainText("Приглашение отправлено");
    await page.getByRole("button", { name: "Позвать в группу" }).click();
    await expect(page.locator(".menu-panel").getByRole("button", { name: /Литклуб/ })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(page.locator(".menu-panel")).toHaveCount(0);

    await as(context, "amir");
    await page.goto("/friends?tab=requests");
    await page.locator(".fr-row", { hasText: "зовёт в «Литклуб»" }).getByRole("button", { name: "Вступить" }).click();
    await expect(page.getByRole("heading", { name: "Литклуб", level: 1 })).toBeVisible();
    await expect(page.locator(".toast")).toContainText("Ты в группе");
  });

  test("Амир видит группы Асель без скрытой и просится в «Кино» — она впускает", async ({ page, context }) => {
    await page.goto(`/friends/${ASEL}`);
    const groups = page.locator(".card", { hasText: "Группы: Асель" });
    await expect(groups).toContainText("Кино");
    await expect(groups).not.toContainText("Шахматы");
    // Ссылка (а с ней и код группы) — только там, где Амир и так состоит.
    await expect(groups.getByRole("link", { name: "Литклуб" })).toBeVisible();
    const cinema = groups.locator(".fr-row", { hasText: "Кино" });
    await expect(cinema.locator("a")).toHaveCount(0);
    await cinema.getByRole("button", { name: "Попроситься" }).click();
    await expect(page.locator(".toast")).toContainText("Просьба отправлена");
    await expect(page.locator(".fr-row", { hasText: "Кино" })).toContainText("просьба отправлена");

    await as(context, "asel");
    await page.goto("/friends");
    await page.locator(".fr-row", { hasText: "просится в «Кино»" }).getByRole("button", { name: "Впустить" }).click();
    await expect(page.locator(".toast")).toContainText("Друг теперь в группе");

    await as(context, "amir");
    await page.goto(`/friends/${ASEL}`);
    await page.locator(".card", { hasText: "Группы: Асель" }).getByRole("link", { name: "Кино" }).click();
    await expect(page.getByRole("heading", { name: "Кино", level: 1 })).toBeVisible();
  });

  test("«⋯» у участника группы: добавить в друзья, у друга — карточка", async ({ page }) => {
    await page.goto("/g/smoke001?at=members");
    await page.getByRole("button", { name: "Действия: Дана" }).click();
    await page.locator(".menu-panel").getByRole("button", { name: "Добавить в друзья" }).click();
    await expect(page.locator(".toast")).toContainText("Заявка отправлена");
    await page.getByRole("button", { name: "Действия: Дана" }).click();
    await expect(page.locator(".menu-panel").getByRole("button", { name: "Заявка ждёт ответа" })).toBeDisabled();
    await page.keyboard.press("Escape");

    const asel = page.locator(".roster-row", { hasText: "Асель" });
    await expect(asel.locator(".badge", { hasText: "друг" })).toBeVisible();
    await page.getByRole("button", { name: "Действия: Асель" }).click();
    await page.locator(".menu-panel").getByRole("link", { name: "Карточка друга" }).click();
    await expect(page).toHaveURL(new RegExp(`/friends/${ASEL}$`));
  });

  test("встреча вдвоём: выбор кнопками, у Асель — в «Заявках», ответ и отмена", async ({ page, context }) => {
    page.on("dialog", (dialog) => void dialog.accept());
    await page.goto(`/friends/${ASEL}`);
    const plan = page.locator("#plan");
    await expect(plan.getByRole("heading", { name: "Встреча вдвоём" })).toBeVisible();
    // Пока не выбрано время, звать нельзя — и выбранного ничего не показано.
    const submit = plan.getByRole("button", { name: "Позвать на встречу" });
    await expect(submit).toBeDisabled();
    await plan.getByRole("radiogroup", { name: "Длительность встречи" }).getByRole("radio", { name: "30 мин", exact: true }).click();
    // Вторая неделя: там точно нет «сегодня, уже поздно».
    await plan.getByRole("radiogroup", { name: "Неделя" }).getByRole("radio").nth(1).click();
    const day = plan.locator(".pp-day:not([disabled])").first();
    await day.click();
    await expect(day).toHaveAttribute("aria-checked", "true");
    // Повторное нажатие на выбранный день прячет и показывает его кнопки начала.
    await day.click();
    await expect(plan.locator(".pp-starts")).toHaveCount(0);
    await day.click();
    const start = plan.locator(".pp-starts").getByRole("radio").first();
    const time = (await start.innerText()).trim();
    await start.click();
    // Время выбрано — выбор свернулся в строку «Время встречи» с выбранным.
    const head = plan.locator(".pp-time-head");
    await expect(head).toHaveAttribute("aria-expanded", "false");
    await expect(head.locator(".pp-chosen")).toContainText(time);
    await expect(plan.locator("#pp-time")).toBeHidden();
    // Строку можно раскрыть и свернуть снова — выбор сохраняется.
    await head.click();
    await expect(plan.locator("#pp-time")).toBeVisible();
    await expect(plan.locator(".pp-day[aria-checked=true]")).toHaveCount(1);
    await head.click();
    await expect(plan.locator("#pp-time")).toBeHidden();
    await expect(head.locator(".pp-chosen")).toContainText(time);
    await plan.getByLabel("Цель").fill("Кофе и курсач");
    await submit.click();
    // В e2e бота нет — приглашение ждёт Асель на сайте.
    await expect(page.locator(".toast")).toContainText("Встреча назначена");
    const meetings = page.locator("#meetings");
    await expect(meetings).toContainText("Кофе и курсач");
    await expect(meetings).toContainText(time);

    await as(context, "asel");
    await page.goto("/friends");
    await expect(page.getByRole("tab", { name: /^Заявки/ })).toHaveAttribute("aria-selected", "true");
    const invite = page.locator(".fr-row", { hasText: "зовёт на встречу «Кофе и курсач»" });
    await expect(invite).toContainText(time);
    await invite.getByRole("button", { name: "Да" }).click();
    await expect(page.locator(".toast")).toContainText("Ответ сохранён");
    await expect(page.locator(".fr-row", { hasText: "Кофе и курсач" })).toHaveCount(0);
    await page.goto(`/friends/${AMIR}`);
    await expect(page.locator("#meetings .daychip.active")).toHaveText("Да");

    await as(context, "amir");
    await page.goto(`/friends/${ASEL}`);
    await page.locator("#meetings").getByRole("button", { name: "Отменить встречу" }).click();
    await expect(page.locator(".toast")).toContainText("Встреча отменена");
  });

  test("«Как это работает» свёрнуто, раскрывается и помнит это после перезагрузки", async ({ page }) => {
    await page.goto(`/friends/${ASEL}`);
    const howto = page.locator('details.howto[data-howto="friend"]');
    await expect(howto).not.toHaveAttribute("open");
    await expect(howto.locator(".howto-steps")).toBeHidden();
    await howto.locator("summary").click();
    await expect(howto.locator(".howto-steps li").first()).toBeVisible();
    await page.reload();
    await expect(page.locator('details.howto[data-howto="friend"]')).toHaveAttribute("open");
    await page.locator('details.howto[data-howto="friend"] summary').click();
    await page.reload();
    await expect(page.locator('details.howto[data-howto="friend"]')).not.toHaveAttribute("open");
  });

  test("блокировка рвёт дружбу; по личной ссылке — снова друзья", async ({ page, context }) => {
    page.on("dialog", (dialog) => void dialog.accept());
    await page.goto(`/friends/${ASEL}`);
    await page.getByRole("button", { name: "Ещё" }).click();
    await page.locator(".menu-panel").getByRole("button", { name: "Заблокировать" }).click();
    await expect(page.locator(".toast")).toContainText("Заблокировано");
    await expect(page.locator("#panel-privacy")).toContainText("Асель");
    await page.locator("#panel-privacy .fr-row", { hasText: "Асель" }).getByRole("button", { name: "Разблокировать" }).click();
    await expect(page.locator(".toast")).toContainText("Разблокировано");

    await page.goto("/friends?tab=add");
    const link = await page.locator(".fr-link-url").innerText();
    expect(link).toMatch(/\/f\/[a-z0-9]{10}$/);

    await as(context, "asel");
    await page.goto(new URL(link).pathname);
    await page.getByRole("button", { name: "Добавить в друзья" }).click();
    await expect(page).toHaveURL(new RegExp(`/friends/${AMIR}`));
    await expect(page.locator(".toast")).toContainText("Теперь вы друзья");
  });

  test("«Участники» на телефоне: «⋯» у правого края, сведения и кнопки — ровно под именем", async ({ page }) => {
    for (const width of [320, 360, 390]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/g/smoke001?at=members");
      const rows = page.locator("#panel-members .roster-row");
      await expect(rows.first()).toBeVisible();
      const layout = await rows.evaluateAll((items) =>
        items.map((row) => {
          const box = (selector: string) => row.querySelector(selector)?.getBoundingClientRect() ?? null;
          const who = box(".roster-who")!;
          const menu = box(".roster-friend .icon-btn");
          const actions = box(".roster-actions");
          // Первый пункт сведений: его точка-разделитель (14 px) спрятана под обрезом слева.
          const facts = box(".roster-facts > span");
          const edge = row.getBoundingClientRect().right;
          return {
            name: row.querySelector(".roster-name b")?.textContent ?? "",
            menuAtEdge: menu ? Math.abs(menu.right - edge) <= 2 && menu.top < who.top + 30 : true,
            actionsUnderName: actions ? Math.abs(actions.left - who.left) <= 1 : true,
            factsUnderName: facts ? Math.abs(facts.left + 14 - who.left) <= 1 : true,
          };
        }),
      );
      for (const row of layout) {
        expect(row, `${width}px: ${row.name}`).toEqual({ ...row, menuAtEdge: true, actionsUnderName: true, factsUnderName: true });
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${width}px`).toBe(0);
    }
  });

  test("чужая карточка и мёртвая ссылка ничего не выдают", async ({ page }) => {
    // Дана — не друг Амира: карточки «нет», как будто такого адреса нет.
    const response = await page.goto("/friends/1004");
    expect(response?.status()).toBe(404);
    await page.goto("/f/abcdefgh23");
    await expect(page.getByRole("heading", { name: "Ссылка не работает" })).toBeVisible();
  });
});
