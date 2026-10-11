// Линтер: правила Next.js (включая хуки React) и TypeScript.
// С Next 16 `eslint-config-next` отдаёт flat config сам, без FlatCompat.
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // Картинки метаданных рисуются в PNG, а не на странице: <img> там — не ошибка.
  // Плагин Next сам пропускает такие файлы, но на Windows сравнивает путь с
  // обратными слэшами и не узнаёт их, — поэтому правило выключено здесь явно.
  {
    files: ["src/app/**/{opengraph-image,twitter-image,icon,apple-icon}.tsx"],
    rules: { "@next/next/no-img-element": "off" },
  },
  // Переменные окружения — только через env() (`src/lib/config.ts`, `scripts/env.mjs`):
  // пустая строка в Vercel = «не задана». `process.env.X ?? запасное` пустую строку
  // пропускал (так упала консоль на DEFAULT_TZ=""). NODE_ENV и NEXT_RUNTIME Next
  // подставляет при сборке, они пустыми не бывают. NEXT_PUBLIC_* в клиентском коде
  // Next встраивает только при буквальном `process.env.NEXT_PUBLIC_X` — env() там
  // вернул бы undefined, поэтому правило их пропускает (пустоту проверять на месте).
  {
    files: ["src/**/*.{ts,tsx}", "scripts/**/*.mjs"],
    ignores: ["src/lib/config.ts", "scripts/env.mjs", "scripts/dev/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[object.type='MemberExpression'][object.object.name='process'][object.property.name='env'][property.name!=/^(NODE_ENV|NEXT_RUNTIME|NEXT_PUBLIC_.+)$/]",
          message: "Читай переменные окружения через env(): пустая строка должна значить «не задана».",
        },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "node_modules/**",
    "coverage/**",
    "graphify-out/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts",
  ]),
]);
