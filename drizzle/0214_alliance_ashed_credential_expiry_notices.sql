ALTER TABLE "alliance_ashed_credentials" ADD COLUMN IF NOT EXISTS "expiry_notice_stage" text;--> statement-breakpoint
ALTER TABLE "alliance_ashed_credentials" ADD COLUMN IF NOT EXISTS "expiry_notice_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "alliance_ashed_credentials" DROP CONSTRAINT IF EXISTS "alliance_ashed_credentials_expiry_notice_stage_check";--> statement-breakpoint
ALTER TABLE "alliance_ashed_credentials" ADD CONSTRAINT "alliance_ashed_credentials_expiry_notice_stage_check" CHECK ("expiry_notice_stage" IS NULL OR "expiry_notice_stage" IN ('upcoming','expired'));
