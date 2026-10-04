ALTER TABLE "regular_event_occurrences"
  ADD COLUMN IF NOT EXISTS "upload_reminded_at" timestamp with time zone;
