CREATE TABLE IF NOT EXISTS "activity_ownership_aliases" (
  "original_hq_user_id" text PRIMARY KEY NOT NULL,
  "personal_owner_hq_user_id" text NOT NULL,
  CONSTRAINT "activity_ownership_alias_not_self" CHECK ("original_hq_user_id" <> "personal_owner_hq_user_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_ownership_alias_owner_idx" ON "activity_ownership_aliases" USING btree ("personal_owner_hq_user_id");
