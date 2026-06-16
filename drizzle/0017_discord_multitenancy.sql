CREATE TABLE IF NOT EXISTS "discord_guild_alliances" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"alliance_id" text NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "alliance_ashed_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"alliance_id" text NOT NULL,
	"app_id" text NOT NULL,
	"origin_url" text NOT NULL,
	"encrypted_token" text NOT NULL,
	"token_expires_at" timestamp with time zone,
	"registered_by_discord_user_id" text,
	"registered_by_hq_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alliance_ashed_credentials_alliance_id_unique" UNIQUE("alliance_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "discord_user_prefs" (
	"discord_user_id" text PRIMARY KEY NOT NULL,
	"locale" text DEFAULT 'en-US' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "discord_guild_alliances" ADD CONSTRAINT "discord_guild_alliances_alliance_id_alliances_id_fk" FOREIGN KEY ("alliance_id") REFERENCES "public"."alliances"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alliance_ashed_credentials" ADD CONSTRAINT "alliance_ashed_credentials_alliance_id_alliances_id_fk" FOREIGN KEY ("alliance_id") REFERENCES "public"."alliances"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alliance_ashed_credentials" ADD CONSTRAINT "alliance_ashed_credentials_registered_by_hq_user_id_hq_users_id_fk" FOREIGN KEY ("registered_by_hq_user_id") REFERENCES "public"."hq_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
