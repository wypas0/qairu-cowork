// Локальный Postgres для smoke-теста: PGlite, выставленный по сетевому протоколу.
// Нужен только разработке — на Vercel базу даёт Supabase.
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const db = await new PGlite();
const migration = await readFile(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
for (const statement of migration.split("--> statement-breakpoint")) {
  const trimmed = statement.trim();
  if (trimmed) await db.exec(trimmed);
}

const server = new PGLiteSocketServer({ db, port: 5544, host: "127.0.0.1" });
await server.start();
console.log("pglite listening on 5544");

process.on("SIGINT", async () => {
  await server.stop();
  process.exit(0);
});
