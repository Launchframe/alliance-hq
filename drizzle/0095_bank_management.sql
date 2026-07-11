ALTER TABLE "battle_plan_capture_events"
  ADD COLUMN IF NOT EXISTS "event_type" text DEFAULT 'capture' NOT NULL;
ALTER TABLE "battle_plan_capture_events"
  ADD COLUMN IF NOT EXISTS "bank_id" text;

CREATE TABLE IF NOT EXISTS "banks" (
  "id" text PRIMARY KEY NOT NULL,
  "alliance_id" text NOT NULL REFERENCES "alliances"("id") ON DELETE CASCADE,
  "game_server_number" integer NOT NULL,
  "coord_x" integer NOT NULL,
  "coord_y" integer NOT NULL,
  "level" integer NOT NULL,
  "captured_at" timestamp with time zone,
  "drop_by_at" timestamp with time zone,
  "deposit_policy" text,
  "prior_capture_count" integer DEFAULT 0 NOT NULL,
  "current_deposit_count" integer,
  "current_deposit_value" double precision,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "banks_alliance_server_coords_unique"
    UNIQUE("alliance_id", "game_server_number", "coord_x", "coord_y")
);

CREATE INDEX IF NOT EXISTS "banks_alliance_id_idx" ON "banks" ("alliance_id");

CREATE TABLE IF NOT EXISTS "bank_deposit_slips" (
  "id" text PRIMARY KEY NOT NULL,
  "alliance_id" text NOT NULL REFERENCES "alliances"("id") ON DELETE CASCADE,
  "bank_id" text NOT NULL REFERENCES "banks"("id") ON DELETE CASCADE,
  "deposit_at" timestamp with time zone NOT NULL,
  "term_days" integer NOT NULL,
  "matures_at" timestamp with time zone NOT NULL,
  "status" text DEFAULT 'locked' NOT NULL,
  "outcome_at" timestamp with time zone,
  "amount" integer NOT NULL,
  "deposit_alliance_tag" text,
  "deposit_alliance_id" text REFERENCES "alliances"("id") ON DELETE SET NULL,
  "commander_name" text NOT NULL,
  "commander_id" text REFERENCES "commanders"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "bank_deposit_slips_bank_status_idx"
  ON "bank_deposit_slips" ("bank_id", "status");
CREATE INDEX IF NOT EXISTS "bank_deposit_slips_alliance_matures_idx"
  ON "bank_deposit_slips" ("alliance_id", "matures_at");

DO $$ BEGIN
  ALTER TABLE "battle_plan_capture_events"
    ADD CONSTRAINT "battle_plan_capture_events_bank_id_banks_id_fk"
    FOREIGN KEY ("bank_id") REFERENCES "banks"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
