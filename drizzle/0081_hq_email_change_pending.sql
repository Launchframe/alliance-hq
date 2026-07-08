CREATE TABLE IF NOT EXISTS "hq_email_change_pending" (
	"id" text PRIMARY KEY NOT NULL,
	"hq_user_id" text NOT NULL REFERENCES "hq_users"("id") ON DELETE CASCADE,
	"new_email" text NOT NULL,
	"code_hash" text NOT NULL,
	"failed_attempts" integer NOT NULL DEFAULT 0,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "hq_email_change_pending_hq_user_id_idx"
	ON "hq_email_change_pending" ("hq_user_id");
