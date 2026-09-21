ALTER TABLE "meetings" ADD COLUMN "repeat_until" date;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "reminded_start" timestamp with time zone;