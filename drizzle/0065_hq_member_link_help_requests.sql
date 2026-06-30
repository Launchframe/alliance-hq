CREATE TABLE IF NOT EXISTS "hq_member_link_help_requests" (
  "id" text PRIMARY KEY NOT NULL,
  "alliance_id" text NOT NULL REFERENCES "alliances"("id") ON DELETE cascade,
  "hq_user_id" text REFERENCES "hq_users"("id") ON DELETE set null,
  "origin" text NOT NULL,
  "discord_user_id" text,
  "discord_username" text,
  "context" text NOT NULL,
  "reported_name" text,
  "game_uid" text,
  "game_user_name" text,
  "requester_handle" text NOT NULL,
  "status" text NOT NULL DEFAULT 'open',
  "resolution_note" text,
  "resolved_at" timestamp with time zone,
  "resolved_by_hq_user_id" text REFERENCES "hq_users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "hq_member_link_help_requests_alliance_id_idx"
  ON "hq_member_link_help_requests" ("alliance_id");

CREATE INDEX IF NOT EXISTS "hq_member_link_help_requests_status_idx"
  ON "hq_member_link_help_requests" ("alliance_id", "status");
