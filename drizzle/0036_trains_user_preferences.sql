ALTER TABLE "hq_users" ADD COLUMN IF NOT EXISTS "trains_display_week_start_dow" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "hq_users" ADD COLUMN IF NOT EXISTS "trains_wheel_spin_speed" text DEFAULT 'slow' NOT NULL;
