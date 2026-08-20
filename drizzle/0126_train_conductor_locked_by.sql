ALTER TABLE "train_conductor_records"
  ADD COLUMN IF NOT EXISTS "locked_by_hq_user_id" text;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "train_conductor_records" ADD CONSTRAINT "train_conductor_records_locked_by_hq_user_id_hq_users_id_fk" FOREIGN KEY ("locked_by_hq_user_id") REFERENCES "public"."hq_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
