ALTER TABLE "bank_deposit_slips"
  ADD COLUMN IF NOT EXISTS "outcome_amount" integer;
