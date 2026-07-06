CREATE TABLE IF NOT EXISTS "hq_alliance_setup_requests" (
  "id" text PRIMARY KEY NOT NULL,
  "tag" text NOT NULL,
  "alliance_name" text NOT NULL,
  "game_server_number" integer NOT NULL,
  "requester_hq_user_id" text NOT NULL REFERENCES "hq_users"("id") ON DELETE cascade,
  "requester_email" text,
  "discord_user_id" text,
  "status" text NOT NULL DEFAULT 'open',
  "fulfilled_alliance_id" text REFERENCES "alliances"("id") ON DELETE set null,
  "fulfilled_by_hq_user_id" text REFERENCES "hq_users"("id") ON DELETE set null,
  "fulfilled_at" timestamp with time zone,
  "resolution_note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "hq_alliance_setup_requests_status_idx"
  ON "hq_alliance_setup_requests" ("status");

CREATE INDEX IF NOT EXISTS "hq_alliance_setup_requests_tag_status_idx"
  ON "hq_alliance_setup_requests" ("tag", "status");

CREATE INDEX IF NOT EXISTS "hq_alliance_setup_requests_requester_tag_status_idx"
  ON "hq_alliance_setup_requests" ("requester_hq_user_id", "tag", "status");
