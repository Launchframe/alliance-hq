ALTER TABLE "alliances"
  ADD COLUMN IF NOT EXISTS "bank_captures_remaining_today" integer;
ALTER TABLE "alliances"
  ADD COLUMN IF NOT EXISTS "bank_captures_limit_today" integer;
ALTER TABLE "alliances"
  ADD COLUMN IF NOT EXISTS "bank_city_list_server_time" timestamp with time zone;
ALTER TABLE "alliances"
  ADD COLUMN IF NOT EXISTS "bank_city_list_captured_count" integer;
ALTER TABLE "alliances"
  ADD COLUMN IF NOT EXISTS "bank_city_list_captured_cap" integer;
ALTER TABLE "alliances"
  ADD COLUMN IF NOT EXISTS "bank_city_list_imported_at" timestamp with time zone;
