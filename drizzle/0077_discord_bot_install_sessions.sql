CREATE TABLE IF NOT EXISTS "discord_bot_install_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"nonce" text NOT NULL UNIQUE,
	"hq_user_id" text NOT NULL,
	"discord_user_id" text NOT NULL,
	"alliance_tag" text NOT NULL,
	"alliance_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
 ALTER TABLE "discord_bot_install_sessions" ADD CONSTRAINT "discord_bot_install_sessions_hq_user_id_hq_users_id_fk" FOREIGN KEY ("hq_user_id") REFERENCES "public"."hq_users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "discord_bot_install_sessions" ADD CONSTRAINT "discord_bot_install_sessions_alliance_id_alliances_id_fk" FOREIGN KEY ("alliance_id") REFERENCES "public"."alliances"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
