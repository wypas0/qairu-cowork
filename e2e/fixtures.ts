import { readFileSync } from "node:fs";

import { type Page, test as base, expect } from "@playwright/test";

/** Что записал e2e-server: код группы и токен входа Амира. */
export function state(): { slug: string; token: string; tokenAsel: string; url: string } {
  return JSON.parse(readFileSync("e2e/.state.json", "utf8"));
}

/**
 * Вход Амиром и сторож ошибок: любая необработанная ошибка страницы или
 * сообщение о сбое гидратации валит тест — так ловится «мёртвая» страница,
 * у которой разметка есть, а кнопки не работают.
 */
export const test = base.extend<{ errors: string[] }>({
  errors: [
    async ({ page, context }, use) => {
      const { token, url } = state();
      await context.addCookies([{ name: "qairu_token", value: token, url, httpOnly: true }]);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error" && /hydrat/i.test(message.text())) errors.push(message.text());
      });
      await use(errors);
      expect(errors, "ошибки на странице").toEqual([]);
    },
    // Сторож нужен каждому тесту, даже если тест его не упоминает.
    { auto: true },
  ],
});

export { expect };

/**
 * Конечные анимации и переходы, которые идут сейчас: «имя @ класс элемента».
 * Бесконечные (бегущая полоса пересчёта, скелетон) не в счёт — это загрузка.
 */
export function running(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    document
      .getAnimations()
      .filter((animation) => animation.playState === "running" && animation.effect?.getComputedTiming().iterations !== Infinity)
      .map((animation) => {
        const effect = animation.effect as KeyframeEffect | null;
        const name =
          animation instanceof CSSAnimation
            ? animation.animationName
            : animation instanceof CSSTransition
              ? animation.transitionProperty
              : "script";
        const target = effect?.target as Element | null;
        return `${name} @ ${target?.className || target?.tagName}${effect?.pseudoElement ?? ""}`;
      }),
  );
}
