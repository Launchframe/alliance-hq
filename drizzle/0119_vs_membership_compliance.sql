-- Alliance VS membership minimums + weekly compliance evaluation (PR4).
-- Informational officer inbox tasks only — HQ never calls confirmMemberRank
-- automatically; officers demote/kick in-game and use Mark complete / Waive.

ALTER TABLE "alliances"
  ADD COLUMN IF NOT EXISTS "vs_membership_min_points" integer;

ALTER TABLE "alliances"
  ADD COLUMN IF NOT EXISTS "vs_membership_miss_strikes_before_kick" integer NOT NULL DEFAULT 3;

ALTER TABLE "alliances"
  ADD COLUMN IF NOT EXISTS "vs_membership_leeway_pct" integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "member_vs_compliance_events" (
  "id" text PRIMARY KEY,
  "alliance_id" text NOT NULL REFERENCES "alliances"("id") ON DELETE CASCADE,
  "ashed_member_id" text NOT NULL,
  "member_name" text NOT NULL,
  "vs_week_ending" text NOT NULL,
  "score" integer NOT NULL,
  "threshold" integer NOT NULL,
  "excused" boolean NOT NULL DEFAULT false,
  "outcome" text NOT NULL,
  "strike_number" integer,
  "officer_task_status" text NOT NULL DEFAULT 'none',
  "waive_reason" text,
  "completed_by_hq_user_id" text REFERENCES "hq_users"("id") ON DELETE SET NULL,
  "waived_by_hq_user_id" text REFERENCES "hq_users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'member_vs_compliance_events_alliance_member_week_unique'
  ) THEN
    ALTER TABLE "member_vs_compliance_events"
      ADD CONSTRAINT "member_vs_compliance_events_alliance_member_week_unique"
      UNIQUE ("alliance_id", "ashed_member_id", "vs_week_ending");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "member_vs_compliance_events_alliance_status_idx"
  ON "member_vs_compliance_events" ("alliance_id", "officer_task_status");
