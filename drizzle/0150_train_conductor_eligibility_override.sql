ALTER TABLE "train_conductor_records"
  ADD COLUMN IF NOT EXISTS "conductor_eligibility_overridden" integer DEFAULT 0 NOT NULL;
