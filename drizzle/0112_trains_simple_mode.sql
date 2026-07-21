-- Per-user Trains Simple Mode preference (guided conductor flow). Default on.
ALTER TABLE "hq_users"
  ADD COLUMN IF NOT EXISTS "trains_simple_mode_enabled" boolean NOT NULL DEFAULT true;
