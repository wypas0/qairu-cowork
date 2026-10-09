ALTER TABLE "owner_audit" ADD COLUMN "target_id" bigint;--> statement-breakpoint
CREATE INDEX "ix_memberships_user_id" ON "memberships" USING btree ("user_id");