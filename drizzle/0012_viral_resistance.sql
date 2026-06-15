ALTER TABLE "alliances" ADD COLUMN IF NOT EXISTS "current_season_key" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "discord_member_links" (
	"id" text PRIMARY KEY NOT NULL,
	"alliance_id" text NOT NULL,
	"discord_user_id" text NOT NULL,
	"discord_username" text,
	"ashed_member_id" text NOT NULL,
	"member_display_name" text,
	"game_uid" text NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discord_member_links_alliance_discord_unique" UNIQUE("alliance_id","discord_user_id"),
	CONSTRAINT "discord_member_links_alliance_member_unique" UNIQUE("alliance_id","ashed_member_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "member_season_vr" (
	"id" text PRIMARY KEY NOT NULL,
	"alliance_id" text NOT NULL,
	"ashed_member_id" text NOT NULL,
	"season_key" text NOT NULL,
	"highest_base_vr" integer NOT NULL,
	"flagged_at" timestamp with time zone,
	"flag_reason" text,
	"updated_by_discord_user_id" text,
	"updated_by_hq_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_season_vr_alliance_member_season_unique" UNIQUE("alliance_id","ashed_member_id","season_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "discord_bot_pending" (
	"discord_user_id" text PRIMARY KEY NOT NULL,
	"alliance_id" text NOT NULL,
	"pending_json" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "discord_bot_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"alliance_id" text NOT NULL,
	"discord_user_id" text,
	"command" text NOT NULL,
	"payload_json" jsonb,
	"result_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "discord_member_links" ADD CONSTRAINT "discord_member_links_alliance_id_alliances_id_fk" FOREIGN KEY ("alliance_id") REFERENCES "public"."alliances"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "member_season_vr" ADD CONSTRAINT "member_season_vr_alliance_id_alliances_id_fk" FOREIGN KEY ("alliance_id") REFERENCES "public"."alliances"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "member_season_vr" ADD CONSTRAINT "member_season_vr_updated_by_hq_user_id_hq_users_id_fk" FOREIGN KEY ("updated_by_hq_user_id") REFERENCES "public"."hq_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "discord_bot_pending" ADD CONSTRAINT "discord_bot_pending_alliance_id_alliances_id_fk" FOREIGN KEY ("alliance_id") REFERENCES "public"."alliances"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "discord_bot_audit" ADD CONSTRAINT "discord_bot_audit_alliance_id_alliances_id_fk" FOREIGN KEY ("alliance_id") REFERENCES "public"."alliances"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
