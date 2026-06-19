ALTER TABLE "alliances" ADD COLUMN IF NOT EXISTS "train_conductor_min_vs_points" integer;
--> statement-breakpoint
ALTER TABLE "alliances" ADD COLUMN IF NOT EXISTS "train_conductor_min_donation_points" integer;
--> statement-breakpoint
ALTER TABLE "alliances" ADD COLUMN IF NOT EXISTS "train_conductor_minimum_leeway_pct" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "alliances" ADD COLUMN IF NOT EXISTS "train_conductor_minimums_window" text DEFAULT 'weekly' NOT NULL;
