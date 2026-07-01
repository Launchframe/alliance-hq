CREATE TABLE IF NOT EXISTS "member_season_vr_events" (
	"id" text PRIMARY KEY NOT NULL,
	"alliance_id" text NOT NULL,
	"season_key" text NOT NULL,
	"ashed_member_id" text NOT NULL,
	"base_vr" integer NOT NULL,
	"previous_base_vr" integer,
	"source" text NOT NULL,
	"reported_by_hq_user_id" text,
	"reported_by_discord_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "member_season_vr_events" ADD CONSTRAINT "member_season_vr_events_alliance_id_alliances_id_fk" FOREIGN KEY ("alliance_id") REFERENCES "public"."alliances"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "member_season_vr_events" ADD CONSTRAINT "member_season_vr_events_reported_by_hq_user_id_hq_users_id_fk" FOREIGN KEY ("reported_by_hq_user_id") REFERENCES "public"."hq_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "member_season_vr_events_member_season_created_idx"
 ON "member_season_vr_events" ("alliance_id", "season_key", "ashed_member_id", "created_at" DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hq_vr_pending" (
	"alliance_id" text NOT NULL,
	"hq_user_id" text NOT NULL,
	"pending_json" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hq_vr_pending_alliance_hq_user_pk" PRIMARY KEY("alliance_id","hq_user_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hq_vr_pending" ADD CONSTRAINT "hq_vr_pending_alliance_id_alliances_id_fk" FOREIGN KEY ("alliance_id") REFERENCES "public"."alliances"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hq_vr_pending" ADD CONSTRAINT "hq_vr_pending_hq_user_id_hq_users_id_fk" FOREIGN KEY ("hq_user_id") REFERENCES "public"."hq_users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
INSERT INTO "member_season_vr_events" (
	"id",
	"alliance_id",
	"season_key",
	"ashed_member_id",
	"base_vr",
	"previous_base_vr",
	"source",
	"reported_by_hq_user_id",
	"reported_by_discord_user_id",
	"created_at"
)
SELECT
	'backfill-' || m."id",
	m."alliance_id",
	m."season_key",
	m."ashed_member_id",
	m."highest_base_vr",
	NULL,
	'backfill',
	m."updated_by_hq_user_id",
	m."updated_by_discord_user_id",
	m."updated_at"
FROM "member_season_vr" m
WHERE NOT EXISTS (
	SELECT 1 FROM "member_season_vr_events" e
	WHERE e."alliance_id" = m."alliance_id"
	  AND e."season_key" = m."season_key"
	  AND e."ashed_member_id" = m."ashed_member_id"
);
