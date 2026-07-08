-- Per-provider OAuth email (for future notification destinations) and one link per provider type per HQ user.
ALTER TABLE "hq_auth_accounts" ADD COLUMN IF NOT EXISTS "provider_email" text;

-- Keep the newest row when duplicate provider types exist on one HQ user (should be rare).
DELETE FROM "hq_auth_accounts" AS older
USING "hq_auth_accounts" AS newer
WHERE older.hq_user_id = newer.hq_user_id
  AND older.provider = newer.provider
  AND older.id < newer.id;

CREATE UNIQUE INDEX IF NOT EXISTS "hq_auth_accounts_hq_user_provider_unique"
  ON "hq_auth_accounts" ("hq_user_id", "provider");
