ALTER TABLE "bank_deposit_slips"
  ADD COLUMN IF NOT EXISTS "alliance_member_id" text
    REFERENCES "alliance_members"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "bank_deposit_slips_alliance_member_id_idx"
  ON "bank_deposit_slips" ("alliance_member_id");
