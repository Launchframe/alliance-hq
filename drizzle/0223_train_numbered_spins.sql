-- Numbered-spin fallback (1..N) when scores are not yet uploaded.
-- Auto-backfilled once scores arrive if the corresponding member slot is still NULL.
ALTER TABLE "train_conductor_records"
  ADD COLUMN IF NOT EXISTS "conductor_numbered_rank" integer,
  ADD COLUMN IF NOT EXISTS "conductor_numbered_pool_size" integer,
  ADD COLUMN IF NOT EXISTS "vip_numbered_rank" integer,
  ADD COLUMN IF NOT EXISTS "vip_numbered_pool_size" integer;
