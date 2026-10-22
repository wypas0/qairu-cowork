ALTER TABLE "meetings" ALTER COLUMN "chat_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "with_user" bigint;--> statement-breakpoint
CREATE INDEX "ix_meetings_with_user" ON "meetings" USING btree ("with_user") WHERE "with_user" is not null;--> statement-breakpoint
CREATE INDEX "ix_meetings_pair_initiator" ON "meetings" USING btree ("initiator_id") WHERE "with_user" is not null;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "ck_meetings_pair" CHECK (("chat_id" is null) = ("with_user" is not null));