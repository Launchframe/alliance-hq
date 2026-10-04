ALTER TABLE "train_event_draws" ADD COLUMN IF NOT EXISTS "request_signature" text;
--> statement-breakpoint
-- Backfill any pre-existing receipts with their candidate hash before enforcing.
UPDATE "train_event_draws" SET "request_signature" = COALESCE("candidates_hash", '') WHERE "request_signature" IS NULL;
--> statement-breakpoint
ALTER TABLE "train_event_draws" ALTER COLUMN "request_signature" SET NOT NULL;
