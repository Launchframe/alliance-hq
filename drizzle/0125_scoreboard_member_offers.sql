-- Officer scoreboard review: offer to create members / apply OCR names. Default off.
ALTER TABLE "hq_users"
  ADD COLUMN IF NOT EXISTS "offer_scoreboard_new_members" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "hq_users"
  ADD COLUMN IF NOT EXISTS "offer_scoreboard_member_names" boolean NOT NULL DEFAULT false;
