CREATE TABLE IF NOT EXISTS "survey_feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"hq_user_id" text,
	"alliance_id" text,
	"video_job_id" text,
	"source" text NOT NULL,
	"positive_experience" integer,
	"feedback" text,
	"outreach_consent" integer,
	"is_complete" integer DEFAULT 0 NOT NULL,
	"dismissed_at" timestamp with time zone,
	"locale" text,
	"page_path" text,
	"app_version" text,
	"browser_version" text,
	"os_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_feedback_report" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text DEFAULT 'bug' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"hq_user_id" text,
	"alliance_id" text,
	"subject" text,
	"description" text NOT NULL,
	"area" text,
	"severity" integer,
	"page_url" text,
	"locale" text,
	"app_version" text,
	"browser_version" text,
	"os_version" text,
	"console_logs" text,
	"capture_session_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bug_report_screenshot" (
	"id" text PRIMARY KEY NOT NULL,
	"report_id" text NOT NULL,
	"storage_key" text NOT NULL,
	"width" integer,
	"height" integer,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "translation_correction_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"hq_user_id" text NOT NULL,
	"alliance_id" text,
	"locale" text NOT NULL,
	"i18n_key" text,
	"candidate_keys" jsonb,
	"displayed_text" text NOT NULL,
	"suggested_translation" text NOT NULL,
	"page_path" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"admin_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hq_platform_commendations" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"category" text DEFAULT 'translation' NOT NULL,
	"threshold_type" text NOT NULL,
	"threshold_value" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hq_platform_commendations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hq_user_platform_commendations" (
	"id" text PRIMARY KEY NOT NULL,
	"hq_user_id" text NOT NULL,
	"commendation_id" text NOT NULL,
	"awarded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb,
	CONSTRAINT "hq_user_platform_commendations_user_slug_unique" UNIQUE("hq_user_id","commendation_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_feedback" ADD CONSTRAINT "survey_feedback_hq_user_id_hq_users_id_fk" FOREIGN KEY ("hq_user_id") REFERENCES "public"."hq_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_feedback" ADD CONSTRAINT "survey_feedback_video_job_id_video_jobs_id_fk" FOREIGN KEY ("video_job_id") REFERENCES "public"."video_jobs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_feedback_report" ADD CONSTRAINT "user_feedback_report_hq_user_id_hq_users_id_fk" FOREIGN KEY ("hq_user_id") REFERENCES "public"."hq_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bug_report_screenshot" ADD CONSTRAINT "bug_report_screenshot_report_id_user_feedback_report_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."user_feedback_report"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "translation_correction_reports" ADD CONSTRAINT "translation_correction_reports_hq_user_id_hq_users_id_fk" FOREIGN KEY ("hq_user_id") REFERENCES "public"."hq_users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "translation_correction_reports" ADD CONSTRAINT "translation_correction_reports_reviewed_by_hq_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."hq_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hq_user_platform_commendations" ADD CONSTRAINT "hq_user_platform_commendations_hq_user_id_hq_users_id_fk" FOREIGN KEY ("hq_user_id") REFERENCES "public"."hq_users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hq_user_platform_commendations" ADD CONSTRAINT "hq_user_platform_commendations_commendation_id_hq_platform_commendations_id_fk" FOREIGN KEY ("commendation_id") REFERENCES "public"."hq_platform_commendations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
INSERT INTO "hq_platform_commendations" ("id", "slug", "label", "description", "category", "threshold_type", "threshold_value", "sort_order", "active")
VALUES
  ('pc-trans-helper', 'translation-helper', 'Translation Helper', 'Suggested a translation that was accepted.', 'translation', 'applied_translation_count', 1, 10, 1),
  ('pc-trans-contributor', 'translation-contributor', 'Translation Contributor', 'Ten accepted translation suggestions.', 'translation', 'applied_translation_count', 10, 20, 1),
  ('pc-trans-patron', 'translation-patron', 'Translation Patron', 'One hundred accepted translation suggestions.', 'translation', 'applied_translation_count', 100, 30, 1)
ON CONFLICT ("slug") DO NOTHING;
