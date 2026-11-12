-- Per-officer override of the conductor + VIP invite message. Null uses the locale default.
ALTER TABLE "hq_users"
  ADD COLUMN IF NOT EXISTS "trains_conductor_invite_template" text;
