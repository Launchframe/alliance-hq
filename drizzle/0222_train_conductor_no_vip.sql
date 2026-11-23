-- Explicit "this train had no VIP" on the conductor record.
-- Distinct from the day's VIP selection rule (which only decides whether to spin).
ALTER TABLE "train_conductor_records"
  ADD COLUMN IF NOT EXISTS "no_vip" integer DEFAULT 0 NOT NULL;
