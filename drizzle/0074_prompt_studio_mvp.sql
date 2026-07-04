ALTER TABLE "hq_users"
  ADD COLUMN IF NOT EXISTS "preferred_image_model" text DEFAULT 'craiyon';

ALTER TABLE "alliance_members"
  ADD COLUMN IF NOT EXISTS "portrait_r2_key" text,
  ADD COLUMN IF NOT EXISTS "portrait_url" text,
  ADD COLUMN IF NOT EXISTS "portrait_source" text;

CREATE TABLE IF NOT EXISTS "train_prompt_templates" (
  "id" text PRIMARY KEY NOT NULL,
  "alliance_id" text REFERENCES "alliances"("id") ON DELETE CASCADE,
  "created_by_hq_user_id" text REFERENCES "hq_users"("id") ON DELETE SET NULL,
  "template_type" text NOT NULL,
  "title" text NOT NULL,
  "current_revision_id" text,
  "visibility" text DEFAULT 'private' NOT NULL,
  "conductor_mechanism" text,
  "season_key" text,
  "event_tag" text,
  "target_conductor_ashed_member_id" text,
  "is_default" integer DEFAULT 0 NOT NULL,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "train_prompt_template_revisions" (
  "id" text PRIMARY KEY NOT NULL,
  "template_id" text NOT NULL REFERENCES "train_prompt_templates"("id") ON DELETE CASCADE,
  "body" text NOT NULL,
  "title" text NOT NULL,
  "visibility" text NOT NULL,
  "conductor_mechanism" text,
  "season_key" text,
  "event_tag" text,
  "revision_number" integer NOT NULL,
  "created_by_hq_user_id" text REFERENCES "hq_users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "train_conductor_generated_images" (
  "id" text PRIMARY KEY NOT NULL,
  "conductor_record_id" text NOT NULL REFERENCES "train_conductor_records"("id") ON DELETE CASCADE,
  "prompt_template_id" text REFERENCES "train_prompt_templates"("id") ON DELETE SET NULL,
  "prompt_template_revision_id" text REFERENCES "train_prompt_template_revisions"("id") ON DELETE SET NULL,
  "prompt_body_used" text NOT NULL,
  "model_provider" text NOT NULL,
  "model_type" text,
  "quality" text DEFAULT 'draft' NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "storage_key" text,
  "external_image_urls" jsonb,
  "selected_external_url" text,
  "error_message" text,
  "created_by_hq_user_id" text REFERENCES "hq_users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finalized_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "train_conductor_announcements" (
  "id" text PRIMARY KEY NOT NULL,
  "conductor_record_id" text NOT NULL UNIQUE REFERENCES "train_conductor_records"("id") ON DELETE CASCADE,
  "image_id" text REFERENCES "train_conductor_generated_images"("id") ON DELETE SET NULL,
  "announcement_text" text DEFAULT '' NOT NULL,
  "announcement_template_id" text REFERENCES "train_prompt_templates"("id") ON DELETE SET NULL,
  "announcement_template_revision_id" text REFERENCES "train_prompt_template_revisions"("id") ON DELETE SET NULL,
  "generation_method" text DEFAULT 'manual' NOT NULL,
  "discord_posted_at" timestamp with time zone,
  "discord_message_id" text,
  "confirmed_at" timestamp with time zone,
  "created_by_hq_user_id" text REFERENCES "hq_users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$
BEGIN
  ALTER TABLE "train_prompt_templates"
    ADD CONSTRAINT "train_prompt_templates_current_revision_fk"
    FOREIGN KEY ("current_revision_id")
    REFERENCES "train_prompt_template_revisions"("id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "train_prompt_templates_alliance_idx"
  ON "train_prompt_templates" ("alliance_id");

CREATE INDEX IF NOT EXISTS "train_conductor_generated_images_record_idx"
  ON "train_conductor_generated_images" ("conductor_record_id");
