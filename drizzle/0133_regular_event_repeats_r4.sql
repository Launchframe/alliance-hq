ALTER TABLE "discord_guild_alliances"
  ADD COLUMN IF NOT EXISTS "r4_channel_id" text;

ALTER TABLE "regular_event_schedule_rules"
  ADD COLUMN IF NOT EXISTS "one_shot_dates" jsonb,
  ADD COLUMN IF NOT EXISTS "biweekly_phase_monday" text;

ALTER TABLE "regular_event_occurrences"
  ADD COLUMN IF NOT EXISTS "schedule_reminded_at" timestamp with time zone;
