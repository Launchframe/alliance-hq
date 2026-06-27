ALTER TABLE "alliance_memberships" ADD COLUMN IF NOT EXISTS "setup_guide_dismissed" integer DEFAULT 0 NOT NULL;
ALTER TABLE "alliance_memberships" ADD COLUMN IF NOT EXISTS "setup_guide_show_on_dashboard" integer DEFAULT 1 NOT NULL;

ALTER TABLE "hq_roster_link_requests" ADD COLUMN IF NOT EXISTS "origin" text DEFAULT 'web' NOT NULL;
ALTER TABLE "hq_roster_link_requests" ADD COLUMN IF NOT EXISTS "discord_user_id" text;
ALTER TABLE "hq_roster_link_requests" ADD COLUMN IF NOT EXISTS "discord_username" text;
ALTER TABLE "hq_roster_link_requests" ADD COLUMN IF NOT EXISTS "target_ashed_member_id" text;

ALTER TABLE "hq_roster_link_requests" ALTER COLUMN "invite_id" DROP NOT NULL;
ALTER TABLE "hq_roster_link_requests" ALTER COLUMN "game_server_number" DROP NOT NULL;
