ALTER TABLE "discord_member_links" DROP CONSTRAINT IF EXISTS "discord_member_links_alliance_discord_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "discord_member_links_alliance_discord_member_unique" ON "discord_member_links" ("alliance_id", "discord_user_id", "ashed_member_id");
