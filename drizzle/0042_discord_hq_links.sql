ALTER TABLE "discord_auth_nonces" ADD COLUMN IF NOT EXISTS "purpose" text DEFAULT 'alliance_credentials' NOT NULL;

CREATE TABLE IF NOT EXISTS "discord_hq_links" (
  "discord_user_id" text PRIMARY KEY NOT NULL,
  "hq_user_id" text NOT NULL REFERENCES "hq_users"("id") ON DELETE CASCADE,
  "linked_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "discord_hq_links_hq_user_id_unique" ON "discord_hq_links" ("hq_user_id");
