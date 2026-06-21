ALTER TABLE "ashed_credentials" ADD COLUMN IF NOT EXISTS "ashed_user_id" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ashed_credentials_ashed_user_id" ON "ashed_credentials" ("ashed_user_id") WHERE "ashed_user_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hq_users_ashed_user_id_unique" ON "hq_users" ("ashed_user_id") WHERE "ashed_user_id" IS NOT NULL;
