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
