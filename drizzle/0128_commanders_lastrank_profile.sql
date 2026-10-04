ALTER TABLE "commanders" ADD COLUMN IF NOT EXISTS "lastrank_public_id" integer;
ALTER TABLE "commanders" ADD COLUMN IF NOT EXISTS "lastrank_country" text;
ALTER TABLE "commanders" ADD COLUMN IF NOT EXISTS "lastrank_profile_image_url" text;
ALTER TABLE "commanders" ADD COLUMN IF NOT EXISTS "lastrank_profile_url" text;

CREATE INDEX IF NOT EXISTS "commanders_lastrank_public_id_idx" ON "commanders" ("lastrank_public_id");
