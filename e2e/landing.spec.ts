import type { Page } from "@playwright/test";

import { expect, running, test } from "./fixtures";

/*
 * Лендинг «Неделя складывается» (docs/landing-2026-11-16/PLAN-OPUS.md).
 * Гость — без куки входа (фикстура входит Амиром, куки стираем). Ничего не
 * создаём и ни во что не вступаем: дальше идёт консоль владельца, она
 * считает группы и участников засеянной базы.
 *
 * Курсор новой страницы стоит в (0, 0). Движение указателя — тоже действие
 * (небо витрины едет за ним), поэтому мышь ставим заранее, до загрузки, как
 * в замерах.
 */

async function openAsGuest(page: Page, width = 1440, height = 900) {
  await page.context().clearCookies();
  await page.setViewportSize({ width, height });
  await page.mouse.move(width / 2, height / 2);
  await page.goto("/", { waitUntil: "networkidle" });
}

/** Ступени клеток витрины одной строкой: «h1h2h4…». */
function heat(page: Page): Promise<string> {
  return page
    .locator(".hero-demo td.cell")
    .evaluateAll((cells) => cells.map((cell) => /h\d/.exec(cell.className)?.[0] ?? "?").join(""));
}

/** Прокрутить к доле прогресса сцены (0 — встала под шапку, 1 — отпускается). */
async function scrollStory(page: Page, progress: number) {
  await page.evaluate((target) => {
    const box = document.querySelector<HTMLElement>(".story")!;
    const scene = box.firstElementChild as HTMLElement;
    const top = parseFloat(box.style.getPropertyValue("--story-top")) || 0;
    const start = box.getBoundingClientRect().top + window.scrollY - top;
    window.scrollTo(0, Math.round(start + target * (box.offsetHeight - scene.offsetHeight)));
  }, progress);
}

const storyP = (page: Page) => page.locator(".story").evaluate((box) => box.style.getPropertyValue("--p"));
const meetOpacity = (page: Page) => page.locator(".story-meet").evaluate((meet) => getComputedStyle(meet).opacity);

test.describe("лендинг: гость", () => {
  test("при загрузке ничего не движется; заголовок страницы — про общее окно", async ({ page }) => {
    await openAsGuest(page);
    await expect(page).toHaveTitle("QairuCowork — общее окно для всей группы");
    await expect(page.locator(".demo-map")).toHaveAttribute("data-ring", "live");
    expect(await running(page)).toEqual([]);
    // Первый экран сразу с действием: обе кнопки витрины на месте.
    const hero = page.locator(".hero");
    await expect(hero.getByRole("link", { name: "Создать группу" })).toBeInViewport();
    await expect(hero.getByRole("link", { name: "У меня есть код" })).toBeInViewport();
  });

  test("нажатие на человека пересчитывает карту и лучшее окно; последнего не выключить", async ({ page }) => {
    await openAsGuest(page);
    const demo = page.locator(".hero-demo");
    const best = demo.locator(".demo-best");
    const ring = demo.locator(".demo-ring");
    const ringAt = () => ring.evaluate((node) => getComputedStyle(node).translate);
    await expect(best).toContainText("12:10–13:00");
    await expect(best).toContainText("свободны все");
    const heatBefore = await heat(page);
    const ringBefore = await ringAt();

    await demo.getByRole("button", { name: "Амир", exact: true }).click();
    await expect(demo.getByRole("button", { name: "Амир", exact: true })).toHaveAttribute("aria-pressed", "false");
    // Амир был занят только в Пн на 1-й паре — окно переезжает туда.
    await expect(best).toContainText("08:00–08:50");
    await expect(best).toContainText("Пн · свободны 7 из 8");
    expect(await heat(page)).not.toBe(heatBefore);
    await expect.poll(ringAt).not.toBe(ringBefore);
    await expect(demo.locator("[aria-live]")).toContainText("Считаем 7 из 8");

    // Наведение на человека гасит клетки, где он занят.
    await demo.getByRole("button", { name: "Болат", exact: true }).hover();
    await expect(demo.locator("td.cell.spot-off")).toHaveCount(10);
    await page.mouse.move(10, 600);
    await expect(demo.locator("td.cell.spot-off")).toHaveCount(0);

    for (const name of ["Асель", "Болат", "Дана", "Ерлан", "Жанна", "Канат"]) {
      await demo.getByRole("button", { name, exact: true }).click();
    }
    const last = demo.getByRole("button", { name: /^Мадина/ });
    await expect(last).toHaveAttribute("aria-disabled", "true");
    await last.click({ force: true });
    await expect(last).toHaveAttribute("aria-pressed", "true");
    await expect(demo.locator("[aria-live]")).toContainText("Считаем 1 из 8");
  });

  test("прокрутка сцены: вначале --p = 0, в конце 1 и на карте встреча", async ({ page }) => {
    await openAsGuest(page);
    await scrollStory(page, 0);
    await expect.poll(() => storyP(page)).toBe("0.0000");
    expect(await meetOpacity(page)).toBe("0");

    // Прокрутка — целые пиксели, поэтому середина — с точностью до пикселя.
    await scrollStory(page, 0.5);
    await expect.poll(async () => Number(await storyP(page))).toBeCloseTo(0.5, 2);
    // Сцена липкая и стоит прямо под шапкой.
    const placed = await page.locator(".story-scene").evaluate((scene) => ({
      top: Math.round(scene.getBoundingClientRect().top),
      bar: Math.round(document.querySelector<HTMLElement>(".topbar")!.getBoundingClientRect().height),
    }));
    expect(placed.top).toBe(placed.bar);

    await scrollStory(page, 1);
    await expect.poll(() => storyP(page)).toBe("1.0000");
    expect(await meetOpacity(page)).toBe("1");
    await expect(page.locator(".story-result")).toContainText("12:10–13:00");
  });

  test("«меньше движения»: сцена не липкая, сразу итог, нажатия без анимаций", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openAsGuest(page);
    const scene = page.locator(".story-scene");
    expect(await scene.evaluate((node) => getComputedStyle(node).position)).toBe("static");
    expect(await meetOpacity(page)).toBe("1");
    await expect(page.locator(".story-cards")).toBeHidden();
    // Сцена и манифест сразу в итоге: прогресс 1, хотя прокрутки не было.
    const progress = (selector: string) =>
      page.locator(selector).evaluate((node) => getComputedStyle(node).getPropertyValue("--p").trim());
    expect(await progress(".story")).toBe("1");
    expect(await progress(".manifest")).toBe("1");

    await page.locator(".hero-demo").getByRole("button", { name: "Амир", exact: true }).click();
    await page.locator(".bento").getByRole("radio", { name: "3 ч" }).click();
    await page.locator(".bento").getByRole("button", { name: "Перенести" }).click();
    await page.locator(".bento").getByRole("switch").click();
    expect(await running(page)).toEqual([]);
    await expect(page.locator(".hero-demo .demo-best")).toContainText("08:00–08:50");
  });

  for (const [width, height] of [
    [390, 844],
    [360, 740],
  ]) {
    test(`телефон ${width}×${height}: нет прокрутки вбок, и в сцене тоже`, async ({ page }) => {
      await openAsGuest(page, width, height);
      const overflow = () =>
        page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(await overflow()).toBeLessThanOrEqual(0);
      for (const progress of [0, 0.3, 0.6, 1]) {
        await scrollStory(page, progress);
        expect(await overflow(), `сцена ${progress}`).toBeLessThanOrEqual(0);
      }
      await page.locator(".bento").scrollIntoViewIfNeeded();
      expect(await overflow()).toBeLessThanOrEqual(0);
    });
  }

  test("«Создать группу» ведёт на вход с возвратом к окну; код группы отправляется формой", async ({ page }) => {
    await openAsGuest(page);
    const create = page.locator(".hero").getByRole("link", { name: "Создать группу" });
    await expect(create).toHaveAttribute("href", "/login?next=%2F%23create");
    await page.locator(".hero").getByRole("link", { name: "У меня есть код" }).click();
    await expect(page).toHaveURL(/#join$/);
    const join = page.locator("#join");
    await expect(join).toBeInViewport();
    // Несуществующий код: сервер возвращает на лендинг с ошибкой у формы.
    await join.getByRole("textbox").fill("NOSUCH99");
    await join.getByRole("button", { name: "Войти" }).click();
    await expect(page).toHaveURL(/\/\?join=notfound#join$/);
    await expect(page.locator("#join [role=alert]")).toBeVisible();

    await create.click();
    await expect(page).toHaveURL(/\/login\?next=%2F%23create$/);
  });
});

test.describe("лендинг: вошедший", () => {
  test("блока «Старт» нет, «Твоя неделя» есть; кнопки витрины открывают окно и сайдбар", async ({ page }) => {
    await page.mouse.move(700, 400);
    await page.goto("/", { waitUntil: "networkidle" });
    expect(await running(page)).toEqual([]);
    await expect(page.locator(".start")).toHaveCount(0);
    await expect(page.locator(".your-week")).toBeVisible();
    await expect(page.locator(".your-week")).toContainText("Твоя неделя");

    const hero = page.locator(".hero");
    await hero.getByRole("link", { name: "Создать группу" }).click();
    await expect(page.locator(".create-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".create-dialog")).toBeHidden();

    await hero.getByRole("button", { name: "У меня есть код" }).click();
    await expect(page.locator(".landing-shell")).toHaveClass(/landing-open/);
    await expect(page.locator("#join-code")).toBeVisible();
  });
});
