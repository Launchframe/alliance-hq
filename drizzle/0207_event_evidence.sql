-- Event evidence ledger, canonical results, readiness and draw receipts.
-- All new tables carry canonical alliance_id; composite FKs keep event/board/
-- batch associations inside one tenant. Member rows stay linked through the
-- tenant-scoped board (membership FK is omitted so departed/imported members
-- can be retained as historical evidence).

-- Composite identity needed by cross-table FKs.
ALTER TABLE "hq_event_series" ADD COLUMN IF NOT EXISTS "event_family" text;
ALTER TABLE "hq_event_series" ADD COLUMN IF NOT EXISTS "scoring_policy" jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS "hq_event_series_alliance_id_unique" ON "hq_event_series"("alliance_id", "id");
--> statement-breakpoint

ALTER TABLE "hq_events" ADD COLUMN IF NOT EXISTS "event_family" text;
ALTER TABLE "hq_events" ADD COLUMN IF NOT EXISTS "policy_version" integer;
CREATE UNIQUE INDEX IF NOT EXISTS "hq_events_alliance_id_unique" ON "hq_events"("alliance_id", "id");
--> statement-breakpoint

ALTER TABLE "hq_event_boards" ADD COLUMN IF NOT EXISTS "alliance_id" text;
UPDATE "hq_event_boards" b SET "alliance_id" = e."alliance_id" FROM "hq_events" e WHERE b."hq_event_id" = e."id" AND b."alliance_id" IS NULL;
ALTER TABLE "hq_event_boards" ALTER COLUMN "alliance_id" SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'hq_event_boards_alliance_fk'
      AND conrelid = 'hq_event_boards'::regclass
  ) THEN
    ALTER TABLE "hq_event_boards"
      ADD CONSTRAINT "hq_event_boards_alliance_fk"
      FOREIGN KEY ("alliance_id") REFERENCES "alliances"("id") ON DELETE CASCADE;
  END IF;
END
$$;
CREATE UNIQUE INDEX IF NOT EXISTS "hq_event_boards_alliance_id_unique" ON "hq_event_boards"("alliance_id", "id");
ALTER TABLE "hq_event_boards" ADD COLUMN IF NOT EXISTS "evidence_version" integer NOT NULL DEFAULT 0;
ALTER TABLE "hq_event_boards" ADD COLUMN IF NOT EXISTS "ready_version" integer;
ALTER TABLE "hq_event_boards" ADD COLUMN IF NOT EXISTS "ready_sources" jsonb;
ALTER TABLE "hq_event_boards" ADD COLUMN IF NOT EXISTS "ready_by" text REFERENCES "hq_users"("id") ON DELETE SET NULL;
ALTER TABLE "hq_event_boards" ADD COLUMN IF NOT EXISTS "ready_at" timestamptz;
ALTER TABLE "hq_event_boards" ADD COLUMN IF NOT EXISTS "empty_confirmed" integer NOT NULL DEFAULT 0;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "hq_event_evidence_batches" (
  "id" text PRIMARY KEY,
  "alliance_id" text NOT NULL REFERENCES "alliances"("id") ON DELETE CASCADE,
  "hq_event_id" text NOT NULL,
  "board_id" text,
  "source_kind" text NOT NULL,
  "source_ref" text,
  "parse_revision" integer,
  "reviewed_revision" integer,
  "status" text NOT NULL DEFAULT 'committed',
  "request_id" text,
  "request_signature" text,
  "content_hash" text,
  "import_manifest" jsonb,
  "import_status" text,
  "legacy_mapping_confirmed" integer NOT NULL DEFAULT 0,
  "created_by" text REFERENCES "hq_users"("id") ON DELETE SET NULL,
  "reviewed_by" text REFERENCES "hq_users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "hq_event_batches_source_kind_check" CHECK ("source_kind" IN ('manual','video','image','ashed_import','legacy_import')),
  CONSTRAINT "hq_event_batches_status_check" CHECK ("status" IN ('staged','committed','superseded')),
  CONSTRAINT "hq_event_batches_import_status_check" CHECK ("import_status" IS NULL OR "import_status" IN ('complete','incomplete')),
  CONSTRAINT "hq_event_batches_event_fk" FOREIGN KEY ("alliance_id","hq_event_id") REFERENCES "hq_events"("alliance_id","id") ON DELETE CASCADE,
  CONSTRAINT "hq_event_batches_board_fk" FOREIGN KEY ("alliance_id","board_id") REFERENCES "hq_event_boards"("alliance_id","id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hq_event_batches_alliance_id_unique" ON "hq_event_evidence_batches"("alliance_id", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "hq_event_batches_request_unique" ON "hq_event_evidence_batches"("alliance_id", "request_id") WHERE "request_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "hq_event_batches_event_idx" ON "hq_event_evidence_batches"("alliance_id", "hq_event_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "hq_event_observations" (
  "id" text PRIMARY KEY,
  "alliance_id" text NOT NULL REFERENCES "alliances"("id") ON DELETE CASCADE,
  "hq_event_id" text NOT NULL,
  "board_id" text NOT NULL,
  "batch_id" text NOT NULL,
  "revision" integer NOT NULL DEFAULT 1,
  "source_row_key" text,
  "member_id" text NOT NULL,
  "member_name" text,
  "evidence_kind" text NOT NULL,
  "real_score" numeric(30,0),
  "stage" integer,
  "observed_rank" integer,
  "poll_option" integer,
  "provenance" text NOT NULL,
  "source_frame" text,
  "source_offset_ms" integer,
  "supersedes_observation_id" text,
  "superseded_by_observation_id" text,
  "retracted" integer NOT NULL DEFAULT 0,
  "correction_actor" text REFERENCES "hq_users"("id") ON DELETE SET NULL,
  "correction_reason" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "hq_event_observations_kind_check" CHECK ("evidence_kind" IN ('leaderboard','poll_yes','poll_no','legacy_leaderboard')),
  CONSTRAINT "hq_event_observations_provenance_check" CHECK ("provenance" IN ('video','image','manual','ashed','legacy')),
  CONSTRAINT "hq_event_observations_poll_score_check" CHECK ("evidence_kind" NOT IN ('poll_yes','poll_no') OR "real_score" IS NULL),
  CONSTRAINT "hq_event_observations_event_fk" FOREIGN KEY ("alliance_id","hq_event_id") REFERENCES "hq_events"("alliance_id","id") ON DELETE CASCADE,
  CONSTRAINT "hq_event_observations_board_fk" FOREIGN KEY ("alliance_id","board_id") REFERENCES "hq_event_boards"("alliance_id","id") ON DELETE CASCADE,
  CONSTRAINT "hq_event_observations_batch_fk" FOREIGN KEY ("alliance_id","batch_id") REFERENCES "hq_event_evidence_batches"("alliance_id","id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hq_event_observations_row_revision_unique" ON "hq_event_observations"("alliance_id", "batch_id", "revision", "source_row_key") WHERE "source_row_key" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "hq_event_observations_board_member_idx" ON "hq_event_observations"("alliance_id", "board_id", "member_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "hq_event_member_results" (
  "id" text PRIMARY KEY,
  "alliance_id" text NOT NULL REFERENCES "alliances"("id") ON DELETE CASCADE,
  "hq_event_id" text NOT NULL,
  "board_id" text NOT NULL,
  "member_id" text NOT NULL,
  "member_name" text,
  "real_score" numeric(30,0),
  "stage" integer,
  "observed_rank" integer,
  "evidence_class" text NOT NULL,
  "participation" text,
  "conflict_kind" text,
  "contributing_observation_ids" jsonb,
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "hq_event_member_results_class_check" CHECK ("evidence_class" IN ('none','explicit_no','yes_only','legacy_leaderboard','real','conflict')),
  CONSTRAINT "hq_event_member_results_event_fk" FOREIGN KEY ("alliance_id","hq_event_id") REFERENCES "hq_events"("alliance_id","id") ON DELETE CASCADE,
  CONSTRAINT "hq_event_member_results_board_fk" FOREIGN KEY ("alliance_id","board_id") REFERENCES "hq_event_boards"("alliance_id","id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hq_event_member_results_unique" ON "hq_event_member_results"("alliance_id", "hq_event_id", "board_id", "member_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "hq_event_sync_items" (
  "id" text PRIMARY KEY,
  "alliance_id" text NOT NULL REFERENCES "alliances"("id") ON DELETE CASCADE,
  "hq_event_id" text NOT NULL,
  "board_id" text,
  "remote_key" text NOT NULL,
  "member_id" text NOT NULL,
  "desired_revision" integer NOT NULL,
  "desired_payload_hash" text,
  "last_synced_revision" integer,
  "last_synced_value_hash" text,
  "status" text NOT NULL DEFAULT 'pending',
  "lease_token" text,
  "lease_expires_at" timestamptz,
  "error_code" text,
  "retry_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "hq_event_sync_items_status_check" CHECK ("status" IN ('pending','synced','conflict','failed','unsupported')),
  CONSTRAINT "hq_event_sync_items_event_fk" FOREIGN KEY ("alliance_id","hq_event_id") REFERENCES "hq_events"("alliance_id","id") ON DELETE CASCADE,
  CONSTRAINT "hq_event_sync_items_board_fk" FOREIGN KEY ("alliance_id","board_id") REFERENCES "hq_event_boards"("alliance_id","id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hq_event_sync_items_remote_key_unique" ON "hq_event_sync_items"("alliance_id", "remote_key");
CREATE INDEX IF NOT EXISTS "hq_event_sync_items_pending_idx" ON "hq_event_sync_items"("status", "lease_expires_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "train_event_draws" (
  "id" text PRIMARY KEY,
  "alliance_id" text NOT NULL REFERENCES "alliances"("id") ON DELETE CASCADE,
  "date" text NOT NULL,
  "role" text NOT NULL,
  "request_id" text NOT NULL,
  "rule_identity" text NOT NULL,
  "rule" jsonb,
  "hq_event_id" text NOT NULL,
  "board_revisions" jsonb,
  "eligibility_fingerprint" text NOT NULL,
  "candidates" jsonb,
  "candidates_hash" text,
  "winner_member_id" text NOT NULL,
  "winner_member_name" text,
  "fallback_used" integer NOT NULL DEFAULT 0,
  "fallback_acknowledged" integer NOT NULL DEFAULT 0,
  "actor_hq_user_id" text REFERENCES "hq_users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "train_event_draws_role_check" CHECK ("role" IN ('conductor','vip')),
  CONSTRAINT "train_event_draws_event_fk" FOREIGN KEY ("alliance_id","hq_event_id") REFERENCES "hq_events"("alliance_id","id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "train_event_draws_request_unique" ON "train_event_draws"("alliance_id", "request_id");
CREATE INDEX IF NOT EXISTS "train_event_draws_date_idx" ON "train_event_draws"("alliance_id", "date");
--> statement-breakpoint

ALTER TABLE "train_conductor_records" ADD COLUMN IF NOT EXISTS "conductor_event_draw_id" text REFERENCES "train_event_draws"("id") ON DELETE SET NULL;
ALTER TABLE "train_conductor_records" ADD COLUMN IF NOT EXISTS "vip_event_draw_id" text REFERENCES "train_event_draws"("id") ON DELETE SET NULL;
--> statement-breakpoint

-- External-link ledger: new links are always unique here. Legacy tables only
-- gain the in-place partial unique index when no duplicates already exist.
CREATE TABLE IF NOT EXISTS "hq_event_external_links" (
  "id" text PRIMARY KEY,
  "alliance_id" text NOT NULL REFERENCES "alliances"("id") ON DELETE CASCADE,
  "entity_kind" text NOT NULL,
  "hq_series_id" text,
  "hq_event_id" text,
  "hq_board_id" text,
  "external_source" text NOT NULL DEFAULT 'ashed',
  "external_id" text NOT NULL,
  "created_by" text REFERENCES "hq_users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "hq_event_external_links_kind_check" CHECK ("entity_kind" IN ('series','event','board')),
  CONSTRAINT "hq_event_external_links_target_check" CHECK (
    ("entity_kind" = 'series' AND "hq_series_id" IS NOT NULL AND "hq_event_id" IS NULL AND "hq_board_id" IS NULL) OR
    ("entity_kind" = 'event' AND "hq_event_id" IS NOT NULL AND "hq_series_id" IS NULL AND "hq_board_id" IS NULL) OR
    ("entity_kind" = 'board' AND "hq_board_id" IS NOT NULL AND "hq_series_id" IS NULL AND "hq_event_id" IS NULL)
  ),
  CONSTRAINT "hq_event_external_links_series_fk" FOREIGN KEY ("alliance_id","hq_series_id") REFERENCES "hq_event_series"("alliance_id","id") ON DELETE CASCADE,
  CONSTRAINT "hq_event_external_links_event_fk" FOREIGN KEY ("alliance_id","hq_event_id") REFERENCES "hq_events"("alliance_id","id") ON DELETE CASCADE,
  CONSTRAINT "hq_event_external_links_board_fk" FOREIGN KEY ("alliance_id","hq_board_id") REFERENCES "hq_event_boards"("alliance_id","id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hq_event_external_links_unique" ON "hq_event_external_links"("alliance_id", "entity_kind", "external_source", "external_id");
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "hq_event_series" WHERE "ashed_series_id" IS NOT NULL
    GROUP BY "alliance_id", "ashed_series_id" HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX "hq_event_series_ashed_unique"
      ON "hq_event_series"("alliance_id", "ashed_series_id")
      WHERE "ashed_series_id" IS NOT NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "hq_events" WHERE "ashed_event_id" IS NOT NULL
    GROUP BY "alliance_id", "ashed_event_id" HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX "hq_events_ashed_unique"
      ON "hq_events"("alliance_id", "ashed_event_id")
      WHERE "ashed_event_id" IS NOT NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "hq_event_boards" WHERE "ashed_event_id" IS NOT NULL
    GROUP BY "alliance_id", "ashed_event_id" HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX "hq_event_boards_ashed_unique"
      ON "hq_event_boards"("alliance_id", "ashed_event_id")
      WHERE "ashed_event_id" IS NOT NULL;
  END IF;
END $$;
