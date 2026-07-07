ALTER TABLE "alliances"
  ADD COLUMN IF NOT EXISTS "self_service_onboarding_enabled" integer DEFAULT 1 NOT NULL;

ALTER TABLE "alliances"
  ADD COLUMN IF NOT EXISTS "invite_onboarding_min_role" text DEFAULT 'officer' NOT NULL;

CREATE TABLE IF NOT EXISTS "hq_member_onboarding_reviews" (
  "id" text PRIMARY KEY NOT NULL,
  "alliance_id" text NOT NULL REFERENCES "alliances"("id") ON DELETE cascade,
  "hq_user_id" text REFERENCES "hq_users"("id") ON DELETE set null,
  "invite_id" text REFERENCES "hq_invites"("id") ON DELETE set null,
  "join_code_id" text REFERENCES "hq_alliance_join_codes"("id") ON DELETE set null,
  "origin" text DEFAULT 'web' NOT NULL,
  "discord_user_id" text,
  "discord_username" text,
  "linked_ashed_member_id" text NOT NULL,
  "game_uid" text NOT NULL,
  "game_user_name" text NOT NULL,
  "game_server_number" integer,
  "game_user_level" integer,
  "status" text DEFAULT 'pending' NOT NULL,
  "suggested_target_ashed_member_id" text,
  "suggestion_method" text,
  "suggested_matched_roster_name" text,
  "resolved_at" timestamp with time zone,
  "resolved_by_hq_user_id" text REFERENCES "hq_users"("id") ON DELETE set null,
  "merged_into_ashed_member_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "hq_member_onboarding_reviews_alliance_id_idx"
  ON "hq_member_onboarding_reviews" ("alliance_id");

CREATE INDEX IF NOT EXISTS "hq_member_onboarding_reviews_status_idx"
  ON "hq_member_onboarding_reviews" ("alliance_id", "status");
