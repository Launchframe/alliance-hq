ALTER TABLE "commanders" ADD COLUMN IF NOT EXISTS "game_avatar_url" text;
--> statement-breakpoint
ALTER TABLE "commanders" ADD COLUMN IF NOT EXISTS "game_avatar_refreshed_at" timestamp with time zone;
