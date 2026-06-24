ALTER TABLE "discord_guild_alliances" ADD COLUMN IF NOT EXISTS "train_channel_id" text;

ALTER TABLE "alliances" ADD COLUMN IF NOT EXISTS "train_discord_announcements_enabled" integer NOT NULL DEFAULT 0;

ALTER TABLE "train_conductor_records" ADD COLUMN IF NOT EXISTS "discord_departing_soon_at" timestamp with time zone;
