CREATE TABLE IF NOT EXISTS "battle_plan_settings" (
  "alliance_id" text PRIMARY KEY NOT NULL REFERENCES "alliances"("id") ON DELETE CASCADE,
  "default_capture_policy" text DEFAULT 'peace' NOT NULL,
  "plan_revision" integer DEFAULT 0 NOT NULL,
  "discord_reports_enabled" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "battle_plan_markers" (
  "id" text PRIMARY KEY NOT NULL,
  "alliance_id" text NOT NULL REFERENCES "alliances"("id") ON DELETE CASCADE,
  "marker_number" integer NOT NULL,
  "label" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "battle_plan_markers_alliance_number" UNIQUE("alliance_id", "marker_number")
);

CREATE TABLE IF NOT EXISTS "battle_plan_capture_events" (
  "id" text PRIMARY KEY NOT NULL,
  "alliance_id" text NOT NULL REFERENCES "alliances"("id") ON DELETE CASCADE,
  "scheduled_at" timestamp with time zone NOT NULL,
  "server_calendar_date" text NOT NULL,
  "territory_type" text NOT NULL,
  "marker_number" integer NOT NULL,
  "capture_policy" text,
  "notes" text,
  "status" text DEFAULT 'scheduled' NOT NULL,
  "created_by_hq_user_id" text REFERENCES "hq_users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "battle_plan_capture_events_alliance_date_idx"
  ON "battle_plan_capture_events" ("alliance_id", "server_calendar_date");

CREATE INDEX IF NOT EXISTS "battle_plan_capture_events_alliance_scheduled_idx"
  ON "battle_plan_capture_events" ("alliance_id", "scheduled_at");
