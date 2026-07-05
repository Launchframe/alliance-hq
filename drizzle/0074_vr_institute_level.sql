ALTER TABLE "member_season_vr"
  ADD COLUMN IF NOT EXISTS "institute_level" integer;
ALTER TABLE "member_season_vr_events"
  ADD COLUMN IF NOT EXISTS "institute_level" integer;
