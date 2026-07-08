CREATE TABLE IF NOT EXISTS "hq_account_merge_pending" (
	"id" text PRIMARY KEY NOT NULL,
	"canonical_hq_user_id" text NOT NULL REFERENCES "hq_users"("id") ON DELETE CASCADE,
	"source_hq_user_id" text NOT NULL REFERENCES "hq_users"("id") ON DELETE CASCADE,
	"code_hash" text NOT NULL,
	"failed_attempts" integer NOT NULL DEFAULT 0,
	"verified_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "hq_account_merge_pending_canonical_idx"
	ON "hq_account_merge_pending" ("canonical_hq_user_id");
