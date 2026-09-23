ALTER TABLE "meetings" ADD COLUMN "summary" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "summary_by" bigint;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "summary_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "calendar_url" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "calendar_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "calendar_error" varchar(32);