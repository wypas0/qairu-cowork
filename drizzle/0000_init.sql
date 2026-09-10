CREATE TABLE "bot_state" (
	"key" varchar(128) PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "busy_slots" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"weekday" integer,
	"specific_date" date,
	"date_from" date,
	"date_to" date,
	"week_parity" integer,
	"start_min" integer NOT NULL,
	"end_min" integer NOT NULL,
	"label" varchar(64) DEFAULT '' NOT NULL,
	"kind" varchar(16) DEFAULT 'class' NOT NULL,
	"source" varchar(16) DEFAULT 'wizard' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chats" (
	"chat_id" bigint PRIMARY KEY NOT NULL,
	"slug" varchar(24),
	"origin" varchar(16) DEFAULT 'telegram' NOT NULL,
	"title" varchar(256) DEFAULT '' NOT NULL,
	"lang" varchar(8) DEFAULT 'ru' NOT NULL,
	"tz" varchar(64) DEFAULT 'Asia/Almaty' NOT NULL,
	"day_start_min" integer DEFAULT 480 NOT NULL,
	"day_end_min" integer DEFAULT 1320 NOT NULL,
	"min_slot_min" integer DEFAULT 30 NOT NULL,
	"travel_buffer_min" integer DEFAULT 0 NOT NULL,
	"semester_start" date,
	"reminder_min" integer DEFAULT 30 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chats_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "meeting_responses" (
	"meeting_id" integer NOT NULL,
	"user_id" bigint NOT NULL,
	"answer" varchar(16) NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"responded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_responses_meeting_id_user_id_pk" PRIMARY KEY("meeting_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" serial PRIMARY KEY NOT NULL,
	"chat_id" bigint NOT NULL,
	"initiator_id" bigint NOT NULL,
	"place" varchar(256) DEFAULT '' NOT NULL,
	"when_text" varchar(256) DEFAULT '' NOT NULL,
	"when_start" timestamp with time zone,
	"goal" text DEFAULT '' NOT NULL,
	"chat_message_id" bigint,
	"invitees" text DEFAULT '' NOT NULL,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"reminder_sent" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"chat_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_chat_id_user_id_pk" PRIMARY KEY("chat_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "schedule_state" (
	"user_id" bigint PRIMARY KEY NOT NULL,
	"filled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"user_id" bigint PRIMARY KEY NOT NULL,
	"username" varchar(64),
	"full_name" varchar(256) DEFAULT '' NOT NULL,
	"lang" varchar(8) DEFAULT 'ru' NOT NULL,
	"is_web" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "web_sessions" (
	"token" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "busy_slots" ADD CONSTRAINT "busy_slots_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_responses" ADD CONSTRAINT "meeting_responses_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_chat_id_chats_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("chat_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_state" ADD CONSTRAINT "schedule_state_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_sessions" ADD CONSTRAINT "web_sessions_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_busy_slots_user_id" ON "busy_slots" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ix_busy_user_weekday" ON "busy_slots" USING btree ("user_id","weekday");--> statement-breakpoint
CREATE INDEX "ix_meetings_chat_id" ON "meetings" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "ix_web_sessions_user_id" ON "web_sessions" USING btree ("user_id");