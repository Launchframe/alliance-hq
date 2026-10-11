ALTER TABLE "hq_users" ADD COLUMN IF NOT EXISTS "preferred_locale" text;--> statement-breakpoint
ALTER TABLE "hq_users" DROP CONSTRAINT IF EXISTS "hq_users_preferred_locale_check";--> statement-breakpoint
ALTER TABLE "hq_users" ADD CONSTRAINT "hq_users_preferred_locale_check" CHECK ("preferred_locale" IS NULL OR "preferred_locale" IN ('en-US','pt-BR','id'));
