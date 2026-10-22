CREATE TABLE "friend_links" (
	"user_id" bigint PRIMARY KEY NOT NULL,
	"code" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friend_links_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "friend_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "friend_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"from_user" bigint NOT NULL,
	"to_user" bigint NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"via" varchar(8) DEFAULT 'search' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "friend_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "friendships" (
	"user_a" bigint NOT NULL,
	"user_b" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friendships_user_a_user_b_pk" PRIMARY KEY("user_a","user_b"),
	CONSTRAINT "ck_friendships_order" CHECK ("user_a" < "user_b")
);
--> statement-breakpoint
ALTER TABLE "friendships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "group_invites" (
	"id" serial PRIMARY KEY NOT NULL,
	"chat_id" bigint NOT NULL,
	"from_user" bigint NOT NULL,
	"to_user" bigint NOT NULL,
	"kind" varchar(8) DEFAULT 'invite' NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "group_invites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "user_blocks" (
	"blocker" bigint NOT NULL,
	"blocked" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_blocks_blocker_blocked_pk" PRIMARY KEY("blocker","blocked")
);
--> statement-breakpoint
ALTER TABLE "user_blocks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "hidden_from_friends" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "friends_see_groups" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "friends_see_free" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "findable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "friend_links" ADD CONSTRAINT "friend_links_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend_requests" ADD CONSTRAINT "friend_requests_from_user_users_user_id_fk" FOREIGN KEY ("from_user") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend_requests" ADD CONSTRAINT "friend_requests_to_user_users_user_id_fk" FOREIGN KEY ("to_user") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_a_users_user_id_fk" FOREIGN KEY ("user_a") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_b_users_user_id_fk" FOREIGN KEY ("user_b") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_invites" ADD CONSTRAINT "group_invites_chat_id_chats_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("chat_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_invites" ADD CONSTRAINT "group_invites_from_user_users_user_id_fk" FOREIGN KEY ("from_user") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_invites" ADD CONSTRAINT "group_invites_to_user_users_user_id_fk" FOREIGN KEY ("to_user") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocker_users_user_id_fk" FOREIGN KEY ("blocker") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocked_users_user_id_fk" FOREIGN KEY ("blocked") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_friend_requests_to" ON "friend_requests" USING btree ("to_user","status");--> statement-breakpoint
CREATE INDEX "ix_friend_requests_from" ON "friend_requests" USING btree ("from_user","status");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_friend_requests_pending" ON "friend_requests" USING btree (least("from_user", "to_user"),greatest("from_user", "to_user")) WHERE "status" = 'pending';--> statement-breakpoint
CREATE INDEX "ix_friendships_user_b" ON "friendships" USING btree ("user_b");--> statement-breakpoint
CREATE INDEX "ix_group_invites_to" ON "group_invites" USING btree ("to_user","status");--> statement-breakpoint
CREATE INDEX "ix_group_invites_from" ON "group_invites" USING btree ("from_user","status");--> statement-breakpoint
CREATE INDEX "ix_group_invites_chat" ON "group_invites" USING btree ("chat_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_group_invites_pending" ON "group_invites" USING btree ("chat_id","kind","from_user","to_user") WHERE "status" = 'pending';--> statement-breakpoint
CREATE INDEX "ix_user_blocks_blocked" ON "user_blocks" USING btree ("blocked");--> statement-breakpoint
CREATE INDEX "ix_users_username_lower" ON "users" USING btree (lower("username"));