-- Токены сессий хранятся только хешем SHA-256: утёкшая таблица (бэкап, лог,
-- чужой доступ к базе) больше не даёт войти в чужой аккаунт. Уже выданные
-- куки продолжают работать — их токены хешируются здесь же, тем же способом,
-- что и в коде (hashToken в src/db/queries/web.ts).
ALTER TABLE "web_sessions" ADD COLUMN "token_hash" varchar(64);--> statement-breakpoint
UPDATE "web_sessions" SET "token_hash" = encode(sha256(convert_to("token", 'UTF8')), 'hex');--> statement-breakpoint
ALTER TABLE "web_sessions" DROP COLUMN "token";--> statement-breakpoint
ALTER TABLE "web_sessions" ALTER COLUMN "token_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "web_sessions" ADD PRIMARY KEY ("token_hash");--> statement-breakpoint
-- Сессии без заходов дольше 30 дней всё равно больше не пускают.
DELETE FROM "web_sessions" WHERE "last_seen_at" < now() - interval '30 days';
