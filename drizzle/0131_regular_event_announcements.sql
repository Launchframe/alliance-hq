ALTER TABLE "alliances" ADD COLUMN IF NOT EXISTS "regular_events_discord_announcements_enabled" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "alliances" ADD COLUMN IF NOT EXISTS "regular_events_canyon_storm_active" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "regular_event_schedule_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"alliance_id" text NOT NULL,
	"event_key" text NOT NULL,
	"schedule_kind" text NOT NULL,
	"weekly_slots" jsonb,
	"interval_days" integer,
	"anchor_time_st" text,
	"announce_lead_minutes" integer DEFAULT 60 NOT NULL,
	"active" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "regular_event_occurrences" (
	"id" text PRIMARY KEY NOT NULL,
	"schedule_rule_id" text NOT NULL,
	"alliance_id" text NOT NULL,
	"event_key" text NOT NULL,
	"occurrence_date" text NOT NULL,
	"scheduled_start_at" timestamp with time zone NOT NULL,
	"announce_at" timestamp with time zone NOT NULL,
	"discord_announced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "regular_event_schedule_rules"
    ADD CONSTRAINT "regular_event_schedule_rules_alliance_id_alliances_id_fk"
    FOREIGN KEY ("alliance_id") REFERENCES "public"."alliances"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "regular_event_occurrences"
    ADD CONSTRAINT "regular_event_occurrences_schedule_rule_id_fk"
    FOREIGN KEY ("schedule_rule_id") REFERENCES "public"."regular_event_schedule_rules"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "regular_event_occurrences"
    ADD CONSTRAINT "regular_event_occurrences_alliance_id_alliances_id_fk"
    FOREIGN KEY ("alliance_id") REFERENCES "public"."alliances"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "regular_event_occurrences"
    ADD CONSTRAINT "regular_event_occurrences_alliance_event_date_unique"
    UNIQUE ("alliance_id", "event_key", "occurrence_date");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "regular_event_schedule_rules_alliance_event_unique"
  ON "regular_event_schedule_rules" ("alliance_id", "event_key");
