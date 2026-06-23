CREATE TABLE IF NOT EXISTS "auth_email_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"code" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "auth_email_codes_email_created_at_idx"
	ON "auth_email_codes" ("email", "created_at" DESC);
