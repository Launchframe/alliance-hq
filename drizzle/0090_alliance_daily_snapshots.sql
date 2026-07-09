CREATE TABLE IF NOT EXISTS "alliance_daily_snapshots" (
  "alliance_id" text NOT NULL,
  "recorded_date" text NOT NULL,
  "active_member_count" integer NOT NULL DEFAULT 0,
  "linked_count" integer NOT NULL DEFAULT 0,
  "unlinked_count" integer NOT NULL DEFAULT 0,
  "thp_total" double precision,
  "thp_p50" double precision,
  "thp_p90" double precision,
  "thp_p99" double precision,
  "donation_total" double precision,
  "donation_p50" double precision,
  "donation_p90" double precision,
  "donation_p99" double precision,
  "computed_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "alliance_daily_snapshots_pkey" PRIMARY KEY ("alliance_id", "recorded_date"),
  CONSTRAINT "alliance_daily_snapshots_alliance_id_alliances_id_fk"
    FOREIGN KEY ("alliance_id") REFERENCES "alliances"("id") ON DELETE cascade
);

CREATE INDEX IF NOT EXISTS "alliance_daily_snapshots_alliance_date_idx"
  ON "alliance_daily_snapshots" ("alliance_id", "recorded_date");
