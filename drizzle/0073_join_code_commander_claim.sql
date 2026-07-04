ALTER TABLE "hq_alliance_join_codes"
  ADD COLUMN IF NOT EXISTS "target_ashed_member_id" text;
