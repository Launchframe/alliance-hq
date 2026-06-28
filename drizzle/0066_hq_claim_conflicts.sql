CREATE TABLE IF NOT EXISTS "hq_claim_conflicts" (
  "id" text PRIMARY KEY NOT NULL,
  "alliance_id" text NOT NULL REFERENCES "alliances"("id") ON DELETE cascade,
  "ashed_member_id" text NOT NULL,
  "commander_name" text NOT NULL,
  "hq_user_id" text REFERENCES "hq_users"("id") ON DELETE set null,
  "handle" text NOT NULL,
  "reason" text NOT NULL,
  "status" text NOT NULL DEFAULT 'open',
  "resolution_note" text,
  "resolved_at" timestamp with time zone,
  "resolved_by_hq_user_id" text REFERENCES "hq_users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "hq_claim_conflicts_alliance_id_idx"
  ON "hq_claim_conflicts" ("alliance_id");

CREATE INDEX IF NOT EXISTS "hq_claim_conflicts_status_idx"
  ON "hq_claim_conflicts" ("alliance_id", "status");
