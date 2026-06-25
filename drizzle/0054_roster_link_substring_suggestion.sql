ALTER TABLE "hq_roster_link_requests" ADD COLUMN IF NOT EXISTS "suggested_target_ashed_member_id" text;
ALTER TABLE "hq_roster_link_requests" ADD COLUMN IF NOT EXISTS "suggestion_method" text;
