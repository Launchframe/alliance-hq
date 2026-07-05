ALTER TABLE "commanders"
  ADD COLUMN IF NOT EXISTS "weekly_pass_active" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "weekly_pass_source" text,
  ADD COLUMN IF NOT EXISTS "weekly_pass_updated_at" timestamptz;
