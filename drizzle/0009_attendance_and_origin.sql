CREATE TABLE "meeting_attendance" (
	"meeting_id" integer NOT NULL,
	"occurrence" date NOT NULL,
	"user_id" bigint NOT NULL,
	"attended" boolean NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_attendance_meeting_id_occurrence_user_id_pk" PRIMARY KEY("meeting_id","occurrence","user_id")
);
--> statement-breakpoint
ALTER TABLE "meeting_attendance" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "busy_slots" ADD COLUMN "valid_from" date;--> statement-breakpoint
ALTER TABLE "busy_slots" ADD COLUMN "valid_to" date;--> statement-breakpoint
ALTER TABLE "busy_slots" ADD COLUMN "except_dates" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "schedule_state" ADD COLUMN "origin" varchar(16) DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "schedule_state" ADD COLUMN "ext_version" varchar(16);--> statement-breakpoint
ALTER TABLE "meeting_attendance" ADD CONSTRAINT "meeting_attendance_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;