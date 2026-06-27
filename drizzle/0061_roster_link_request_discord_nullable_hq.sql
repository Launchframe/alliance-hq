ALTER TABLE "hq_roster_link_requests" ALTER COLUMN "hq_user_id" DROP NOT NULL;
ALTER TABLE "hq_roster_link_requests" ADD COLUMN IF NOT EXISTS "suggested_matched_roster_name" text;
