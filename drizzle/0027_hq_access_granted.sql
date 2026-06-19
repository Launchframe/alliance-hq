ALTER TABLE "hq_users" ADD COLUMN IF NOT EXISTS "access_granted_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "hq_users"
SET "access_granted_at" = COALESCE("created_at", now())
WHERE "access_granted_at" IS NULL;
