-- Bidirectional Ashed ExcusedRecord <-> member_time_off sync (PR3).
-- activity_scope mirrors Ashed ExcusedRecord.record_type ("vs" | "donation"),
-- with "all" meaning both were created together (Ashed's "All Activities" = two POSTs).
ALTER TABLE "member_time_off"
  ADD COLUMN IF NOT EXISTS "activity_scope" text NOT NULL DEFAULT 'all';

-- Ashed ExcusedRecord id(s) this row was synced from / pushed to.
-- One id for vs-only or donation-only rows, two ids (vs + donation) for "all" rows.
ALTER TABLE "member_time_off"
  ADD COLUMN IF NOT EXISTS "ashed_excused_ids" jsonb;
