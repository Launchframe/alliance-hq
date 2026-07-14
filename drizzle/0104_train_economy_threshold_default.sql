-- Default Price Is Freight economy threshold: 8.5M prior-day VS.
ALTER TABLE "alliances"
  ALTER COLUMN "train_economy_threshold_points" SET DEFAULT 8500000;--> statement-breakpoint
UPDATE "alliances"
SET "train_economy_threshold_points" = 8500000
WHERE "train_economy_threshold_points" IS NULL;
