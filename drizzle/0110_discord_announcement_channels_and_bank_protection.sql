ALTER TABLE "discord_guild_alliances" ADD COLUMN "seasonal_events_channel_id" text;
ALTER TABLE "discord_guild_alliances" ADD COLUMN "regular_events_channel_id" text;
ALTER TABLE "discord_guild_alliances" ADD COLUMN "banking_channel_id" text;

ALTER TABLE "banks" ADD COLUMN "protection_expires_at" timestamp with time zone;
ALTER TABLE "banks" ADD COLUMN "discord_protection_last_milestone" integer;

ALTER TABLE "battle_plan_capture_events" ADD COLUMN "discord_announced_at" timestamp with time zone;
