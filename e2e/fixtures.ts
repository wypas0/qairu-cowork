import { readFileSync } from "node:fs";

import { test as base, expect } from "@playwright/test";

/** Что записал e2e-server: код группы и токен входа Амира. */
export function state(): { slug: string; token: string; url: string } {
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
