ALTER TABLE "alliances" ADD COLUMN IF NOT EXISTS "alliance_safe_time_slot" text;

ALTER TABLE "banks" ADD COLUMN IF NOT EXISTS "counterparty_risk_score" real;
ALTER TABLE "banks" ADD COLUMN IF NOT EXISTS "counterparty_risk_updated_at" timestamp with time zone;
