ALTER TABLE "alliances" ADD COLUMN IF NOT EXISTS "train_conductor_lead_time_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "alliances" ADD COLUMN IF NOT EXISTS "train_conductor_confirmation_enabled" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "train_conductor_records" ADD COLUMN IF NOT EXISTS "conductor_nomination_status" text;--> statement-breakpoint
ALTER TABLE "train_conductor_records" ADD COLUMN IF NOT EXISTS "nomination_trigger" text;--> statement-breakpoint
ALTER TABLE "train_conductor_records" ADD COLUMN IF NOT EXISTS "nominated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "train_conductor_records" ADD COLUMN IF NOT EXISTS "conductor_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "train_conductor_records" ADD COLUMN IF NOT EXISTS "conductor_confirmed_by_hq_user_id" text;--> statement-breakpoint
ALTER TABLE "train_conductor_records" ADD COLUMN IF NOT EXISTS "confirmation_deadline_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "train_conductor_records" ADD COLUMN IF NOT EXISTS "successor_attempt" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "train_conductor_records" ADD COLUMN IF NOT EXISTS "succession_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "train_conductor_records" ADD COLUMN IF NOT EXISTS "discord_nomination_mentioned_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "train_conductor_records"
    ADD CONSTRAINT "train_conductor_records_confirmed_by_hq_user_fk"
    FOREIGN KEY ("conductor_confirmed_by_hq_user_id") REFERENCES "hq_users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
