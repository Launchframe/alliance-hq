CREATE TABLE IF NOT EXISTS "auth_send_code_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"client_ip" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS "auth_send_code_attempts_created_at_idx"
	ON "auth_send_code_attempts" ("created_at" DESC);

CREATE INDEX IF NOT EXISTS "auth_send_code_attempts_ip_created_at_idx"
	ON "auth_send_code_attempts" ("client_ip", "created_at" DESC);

CREATE TABLE IF NOT EXISTS "auth_ops_alert_fingerprints" (
	"fingerprint" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
