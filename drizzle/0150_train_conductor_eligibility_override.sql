ALTER TABLE "train_conductor_records"
  ADD COLUMN IF NOT EXISTS "conductor_eligibility_overridden" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "train_conductor_records"
  ADD COLUMN IF NOT EXISTS "conductor_eligibility_overridden_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "train_conductor_records"
  ADD COLUMN IF NOT EXISTS "conductor_eligibility_overridden_by_hq_user_id" text;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "train_conductor_records" ADD CONSTRAINT "train_conductor_records_eligibility_overridden_by_hq_users_id_fk" FOREIGN KEY ("conductor_eligibility_overridden_by_hq_user_id") REFERENCES "public"."hq_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
