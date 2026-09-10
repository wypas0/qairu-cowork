import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  // Supabase держит свои служебные схемы в той же базе — не трогаем их.
  schemaFilter: ["public"],
} satisfies Config;
