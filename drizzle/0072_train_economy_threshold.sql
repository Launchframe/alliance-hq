ALTER TABLE "alliances" ADD COLUMN IF NOT EXISTS "train_economy_threshold_points" integer;
ALTER TABLE "alliances" ADD COLUMN IF NOT EXISTS "train_economy_threshold_fudge_pct" integer DEFAULT 1 NOT NULL;
