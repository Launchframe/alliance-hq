-- Member Ashed parity columns, stat history tables, roster video parse fields

ALTER TABLE "alliance_members" ADD COLUMN IF NOT EXISTS "join_date" text;--> statement-breakpoint
ALTER TABLE "alliance_members" ADD COLUMN IF NOT EXISTS "profession" text;--> statement-breakpoint
ALTER TABLE "alliance_members" ADD COLUMN IF NOT EXISTS "professional_level" integer;--> statement-breakpoint
ALTER TABLE "alliance_members" ADD COLUMN IF NOT EXISTS "power_level" text;--> statement-breakpoint
ALTER TABLE "alliance_members" ADD COLUMN IF NOT EXISTS "current_kills" double precision;--> statement-breakpoint
ALTER TABLE "alliance_members" ADD COLUMN IF NOT EXISTS "current_total_hero_power" double precision;--> statement-breakpoint
ALTER TABLE "alliance_members" ADD COLUMN IF NOT EXISTS "notes" text;--> statement-breakpoint
ALTER TABLE "alliance_members" ADD COLUMN IF NOT EXISTS "timezone" text;--> statement-breakpoint
ALTER TABLE "alliance_members" ADD COLUMN IF NOT EXISTS "recorded_date" text;--> statement-breakpoint
ALTER TABLE "alliance_members" ADD COLUMN IF NOT EXISTS "ashed_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "alliance_members" ADD COLUMN IF NOT EXISTS "ashed_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "alliance_members" ADD COLUMN IF NOT EXISTS "current_squad_power_json" jsonb;--> statement-breakpoint
ALTER TABLE "alliance_members" ADD COLUMN IF NOT EXISTS "squad_power_snapshots_json" jsonb;--> statement-breakpoint
ALTER TABLE "alliance_members" ADD COLUMN IF NOT EXISTS "is_sample" boolean;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "member_profession_level_events" (
  "id" text PRIMARY KEY NOT NULL,
  "alliance_id" text NOT NULL REFERENCES "alliances"("id") ON DELETE cascade,
  "ashed_member_id" text NOT NULL,
  "member_name" text NOT NULL,
  "value" integer NOT NULL,
  "recorded_date" text NOT NULL,
  "source" text NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
  "recorded_by_hq_user_id" text REFERENCES "hq_users"("id") ON DELETE set null
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "member_game_level_events" (
  "id" text PRIMARY KEY NOT NULL,
  "alliance_id" text NOT NULL REFERENCES "alliances"("id") ON DELETE cascade,
  "ashed_member_id" text NOT NULL,
  "member_name" text NOT NULL,
  "value" integer NOT NULL,
  "recorded_date" text NOT NULL,
  "source" text NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
  "recorded_by_hq_user_id" text REFERENCES "hq_users"("id") ON DELETE set null
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "member_power_level_events" (
  "id" text PRIMARY KEY NOT NULL,
  "alliance_id" text NOT NULL REFERENCES "alliances"("id") ON DELETE cascade,
  "ashed_member_id" text NOT NULL,
  "member_name" text NOT NULL,
  "value" text NOT NULL,
  "recorded_date" text NOT NULL,
  "source" text NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
  "recorded_by_hq_user_id" text REFERENCES "hq_users"("id") ON DELETE set null
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "member_total_hero_power_events" (
  "id" text PRIMARY KEY NOT NULL,
  "alliance_id" text NOT NULL REFERENCES "alliances"("id") ON DELETE cascade,
  "ashed_member_id" text NOT NULL,
  "member_name" text NOT NULL,
  "value" double precision NOT NULL,
  "recorded_date" text NOT NULL,
  "source" text NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
  "recorded_by_hq_user_id" text REFERENCES "hq_users"("id") ON DELETE set null
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "member_kills_events" (
  "id" text PRIMARY KEY NOT NULL,
  "alliance_id" text NOT NULL REFERENCES "alliances"("id") ON DELETE cascade,
  "ashed_member_id" text NOT NULL,
  "member_name" text NOT NULL,
  "value" double precision NOT NULL,
  "recorded_date" text NOT NULL,
  "source" text NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
  "recorded_by_hq_user_id" text REFERENCES "hq_users"("id") ON DELETE set null
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "member_commendations" (
  "id" text PRIMARY KEY NOT NULL,
  "alliance_id" text NOT NULL REFERENCES "alliances"("id") ON DELETE cascade,
  "ashed_member_id" text NOT NULL,
  "member_name" text NOT NULL,
  "commendation_type" text,
  "notes" text,
  "recorded_date" text,
  "ashed_commendation_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "member_violations" (
  "id" text PRIMARY KEY NOT NULL,
  "alliance_id" text NOT NULL REFERENCES "alliances"("id") ON DELETE cascade,
  "ashed_member_id" text NOT NULL,
  "member_name" text NOT NULL,
  "violation_type" text,
  "notes" text,
  "recorded_date" text,
  "ashed_violation_id" text,
  "expunged_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "parse_sessions" ADD COLUMN IF NOT EXISTS "raw_extract_json" jsonb;--> statement-breakpoint

ALTER TABLE "parsed_rows" ALTER COLUMN "score" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "parsed_rows" ADD COLUMN IF NOT EXISTS "roster_rank_raw" text;--> statement-breakpoint
ALTER TABLE "parsed_rows" ADD COLUMN IF NOT EXISTS "alliance_rank" integer;--> statement-breakpoint
ALTER TABLE "parsed_rows" ADD COLUMN IF NOT EXISTS "alliance_rank_title" text;--> statement-breakpoint
ALTER TABLE "parsed_rows" ADD COLUMN IF NOT EXISTS "power_level" text;--> statement-breakpoint
ALTER TABLE "parsed_rows" ADD COLUMN IF NOT EXISTS "member_level" integer;--> statement-breakpoint
ALTER TABLE "parsed_rows" ADD COLUMN IF NOT EXISTS "profession" text;
