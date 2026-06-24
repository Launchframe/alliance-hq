CREATE TABLE IF NOT EXISTS "hq_roster_link_requests" (
  "id" text PRIMARY KEY NOT NULL,
  "alliance_id" text NOT NULL REFERENCES "alliances"("id") ON DELETE cascade,
  "hq_user_id" text NOT NULL REFERENCES "hq_users"("id") ON DELETE cascade,
  "invite_id" text REFERENCES "hq_invites"("id") ON DELETE set null,
  "reported_name" text NOT NULL,
  "game_uid" text NOT NULL,
  "game_user_name" text NOT NULL,
  "game_server_number" integer NOT NULL,
  "game_user_level" integer,
  "status" text NOT NULL DEFAULT 'pending',
  "resolved_at" timestamp with time zone,
  "resolved_by_hq_user_id" text REFERENCES "hq_users"("id") ON DELETE set null,
  "created_member_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "hq_roster_link_requests_alliance_id_idx"
  ON "hq_roster_link_requests" ("alliance_id");

CREATE INDEX IF NOT EXISTS "hq_roster_link_requests_hq_user_id_idx"
  ON "hq_roster_link_requests" ("hq_user_id");

CREATE UNIQUE INDEX IF NOT EXISTS "hq_roster_link_requests_pending_alliance_user_unique"
  ON "hq_roster_link_requests" ("alliance_id", "hq_user_id")
  WHERE "status" = 'pending';

CREATE TABLE IF NOT EXISTS "hq_roster_link_action_tokens" (
  "id" text PRIMARY KEY NOT NULL,
  "request_id" text NOT NULL REFERENCES "hq_roster_link_requests"("id") ON DELETE cascade,
  "action" text NOT NULL,
  "token_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "hq_roster_link_action_tokens_token_hash_unique"
  ON "hq_roster_link_action_tokens" ("token_hash");

CREATE INDEX IF NOT EXISTS "hq_roster_link_action_tokens_request_id_idx"
  ON "hq_roster_link_action_tokens" ("request_id");
