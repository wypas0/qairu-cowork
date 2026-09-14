// Локальный Postgres для smoke-теста: PGlite, выставленный по сетевому протоколу.
// Нужен только разработке — на Vercel базу даёт Supabase.
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const db = await new PGlite();
// Все миграции по порядку номеров — так же, как их выполняют в Supabase.
const dir = new URL("../../drizzle/", import.meta.url);
const files = (await readdir(dir)).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
for (const file of files) {
  const migration = await readFile(new URL(file, dir), "utf8");
  for (const statement of migration.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed) await db.exec(trimmed);
  }
}

const server = new PGLiteSocketServer({ db, port: 5544, host: "127.0.0.1" });
await server.start();
console.log("pglite listening on 5544");

process.on("SIGINT", async () => {
  await server.stop();
  process.exit(0);
});
