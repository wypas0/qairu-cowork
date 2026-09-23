import { defineConfig, devices } from "@playwright/test";

/**
 * Сквозные тесты: настоящий браузер против собранного сайта с наполненной
 * базой (scripts/dev/e2e-server.mjs). Перед запуском — `npx next build`.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:3200",
    locale: "ru-RU",
    timezoneId: "Asia/Almaty",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/dev/e2e-server.mjs 3200",
    url: "http://localhost:3200/api/healthz",
    reuseExistingServer: !process.env.CI,
    timeout: 90_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
});
