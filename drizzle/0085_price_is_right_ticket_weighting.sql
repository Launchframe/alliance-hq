ALTER TABLE "alliances" ADD COLUMN IF NOT EXISTS "train_price_is_right_weighting_enabled" integer DEFAULT 0 NOT NULL;
ALTER TABLE "alliances" ADD COLUMN IF NOT EXISTS "train_price_is_right_hard_cutoff_enabled" integer DEFAULT 0 NOT NULL;
ALTER TABLE "alliances" ADD COLUMN IF NOT EXISTS "train_price_is_right_max_ticket_member_ids" jsonb;

ALTER TABLE "conductor_pool_entries" ADD COLUMN IF NOT EXISTS "ticket_count" integer;
ALTER TABLE "conductor_pool_entries" ADD COLUMN IF NOT EXISTS "prior_day_vs_score" integer;
