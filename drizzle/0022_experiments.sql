CREATE TABLE IF NOT EXISTS "parse_configs" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "pass_key" text NOT NULL,
  "description" text,
  "config_json" jsonb NOT NULL,
  "status" text NOT NULL DEFAULT 'draft',
  "notes" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_by_user_id" text
);

CREATE TABLE IF NOT EXISTS "experiment_campaigns" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "hypothesis" text,
  "score_target" text NOT NULL,
  "board_key" text,
  "status" text NOT NULL DEFAULT 'draft',
  "traffic_percent" integer NOT NULL DEFAULT 100,
  "started_at" timestamp with time zone,
  "concluded_at" timestamp with time zone,
  "conclusion" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_by_user_id" text
);

CREATE TABLE IF NOT EXISTS "experiment_arms" (
  "id" text PRIMARY KEY NOT NULL,
  "campaign_id" text NOT NULL,
  "name" text NOT NULL,
  "is_control" boolean NOT NULL DEFAULT false,
  "config_id" text,
  "traffic_weight" integer NOT NULL DEFAULT 50,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "config_assignments" (
  "id" text PRIMARY KEY NOT NULL,
  "score_target" text,
  "board_key" text,
  "config_id" text NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_by_user_id" text,
  UNIQUE ("score_target", "board_key")
);

ALTER TABLE "video_upload_groups"
  ADD COLUMN IF NOT EXISTS "experiment_campaign_id" text,
  ADD COLUMN IF NOT EXISTS "experiment_arm_id" text;

ALTER TABLE "experiment_arms"
  ADD CONSTRAINT "experiment_arms_campaign_id_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "experiment_campaigns"("id") ON DELETE CASCADE;
