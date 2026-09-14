CREATE TABLE "credentials" (
	"user_id" bigint PRIMARY KEY NOT NULL,
	"login" varchar(32) NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credentials_login_unique" UNIQUE("login")
);
--> statement-breakpoint
CREATE TABLE "notices" (
	"id" serial PRIMARY KEY NOT NULL,
	"chat_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"kind" varchar(24) NOT NULL,
	"meeting_id" integer,
	"from_user_id" bigint,
	"text" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "created_by" bigint;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "role" varchar(16) DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_chat_id_chats_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("chat_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_notices_user_chat" ON "notices" USING btree ("user_id","chat_id");--> statement-breakpoint
-- Перенос данных: у групп, созданных на сайте до появления ролей, создатель не
-- записан. Группа создаётся одной транзакцией вместе с первым участником, поэтому
-- самый ранний участник и есть создатель — он становится администратором.
UPDATE "chats" AS c
SET "created_by" = first_member."user_id"
FROM (
	SELECT DISTINCT ON ("chat_id") "chat_id", "user_id"
	FROM "memberships"
	ORDER BY "chat_id", "joined_at", "user_id"
) AS first_member
WHERE c."chat_id" = first_member."chat_id"
	AND c."origin" = 'web'
	AND c."created_by" IS NULL;--> statement-breakpoint
UPDATE "memberships" AS m
SET "role" = 'admin'
FROM "chats" AS c
WHERE c."chat_id" = m."chat_id"
	AND c."created_by" = m."user_id";
