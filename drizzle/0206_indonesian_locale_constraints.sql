ALTER TABLE "plunder_plan_digest_settings" DROP CONSTRAINT IF EXISTS "plunder_plan_digest_settings_locale_check";
--> statement-breakpoint
ALTER TABLE "plunder_plan_digest_settings" ADD CONSTRAINT "plunder_plan_digest_settings_locale_check" CHECK ("plunder_plan_digest_settings"."locale" IN ('en-US', 'pt-BR', 'id'));
--> statement-breakpoint
ALTER TABLE "knowledge_generation_jobs" DROP CONSTRAINT IF EXISTS "knowledge_generation_jobs_locale_check";
--> statement-breakpoint
ALTER TABLE "knowledge_generation_jobs" ADD CONSTRAINT "knowledge_generation_jobs_locale_check" CHECK ("knowledge_generation_jobs"."locale" IN ('en-US', 'pt-BR', 'id'));
--> statement-breakpoint
ALTER TABLE "knowledge_publications" DROP CONSTRAINT IF EXISTS "knowledge_publications_locale_check";
--> statement-breakpoint
ALTER TABLE "knowledge_publications" ADD CONSTRAINT "knowledge_publications_locale_check" CHECK ("knowledge_publications"."locale" IN ('en-US', 'pt-BR', 'id'));
