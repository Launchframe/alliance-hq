CREATE TABLE IF NOT EXISTS "video_vs_evidence" (
  "scope_key" text PRIMARY KEY,
  "job_id" text NOT NULL REFERENCES "video_jobs"("id") ON DELETE CASCADE,
  "alliance_id" text NOT NULL REFERENCES "alliances"("id") ON DELETE CASCADE,
  "recorded_date" text NOT NULL,
  "period" text NOT NULL DEFAULT 'daily',
  "version" integer NOT NULL DEFAULT 1,
  "image_version" integer NOT NULL DEFAULT 0,
  "requested_kind" text NOT NULL DEFAULT 'auto',
  "status" text NOT NULL DEFAULT 'none',
  "file_name" text,
  "content_type" text,
  "file_size" integer,
  "upload_key" text,
  "storage_key" text,
  "image_sha256" text,
  "candidate" jsonb,
  "draft" jsonb,
  "error_code" text,
  "applied_image_version" integer,
  "lease_token" text,
  "lease_expires_at" timestamptz,
  "uploaded_by_hq_user_id" text REFERENCES "hq_users"("id") ON DELETE SET NULL,
  "updated_by_hq_user_id" text REFERENCES "hq_users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "video_vs_evidence_period_check" CHECK ("period" IN ('daily', 'weekly')),
  CONSTRAINT "video_vs_evidence_status_check" CHECK ("status" IN ('none','uploading','queued','running','needs_type','ready','failed')),
  CONSTRAINT "video_vs_evidence_kind_check" CHECK ("requested_kind" IN ('auto','daily_totals','weekly_overview')),
  CONSTRAINT "video_vs_evidence_versions_check" CHECK ("version" > 0 AND "image_version" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "video_vs_evidence_alliance_idx" ON "video_vs_evidence"("alliance_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "video_vs_evidence_pending_idx" ON "video_vs_evidence"("status", "lease_expires_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "video_vs_evidence_scope_alliance_unique" ON "video_vs_evidence"("scope_key", "alliance_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "video_vs_evidence_receipts" (
 "scope_key" text NOT NULL,
 "alliance_id" text NOT NULL,
 "request_id" text NOT NULL,
 "digest" text NOT NULL,
 "result" jsonb NOT NULL,
 "created_at" timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY ("scope_key", "request_id"),
 FOREIGN KEY ("scope_key", "alliance_id") REFERENCES "video_vs_evidence"("scope_key", "alliance_id") ON DELETE CASCADE
);
