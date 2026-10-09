CREATE TABLE "owner_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"event" varchar(16) NOT NULL,
	"ok" boolean NOT NULL,
	"ip_hash" varchar(64) DEFAULT '' NOT NULL,
	"ua_hash" varchar(64) DEFAULT '' NOT NULL,
	"device" varchar(48) DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "owner_audit" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "owner_login_codes" (
	"user_id" bigint PRIMARY KEY NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"salt" varchar(32) NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "owner_login_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "owner_sessions" (
	"token_hash" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"web_token_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "owner_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "owner_login_codes" ADD CONSTRAINT "owner_login_codes_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_sessions" ADD CONSTRAINT "owner_sessions_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_owner_audit_created_at" ON "owner_audit" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ix_owner_sessions_user_id" ON "owner_sessions" USING btree ("user_id");