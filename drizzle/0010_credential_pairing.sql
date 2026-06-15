CREATE TABLE IF NOT EXISTS "credential_pairing_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"purpose" text NOT NULL,
	"source_session_id" text NOT NULL,
	"source_hq_user_id" text,
	"alliance_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"consumed_by_session_id" text,
	"metadata_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credential_pairing_codes" ADD CONSTRAINT "credential_pairing_codes_source_session_id_sessions_id_fk" FOREIGN KEY ("source_session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credential_pairing_codes" ADD CONSTRAINT "credential_pairing_codes_source_hq_user_id_hq_users_id_fk" FOREIGN KEY ("source_hq_user_id") REFERENCES "public"."hq_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credential_pairing_codes" ADD CONSTRAINT "credential_pairing_codes_alliance_id_alliances_id_fk" FOREIGN KEY ("alliance_id") REFERENCES "public"."alliances"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credential_pairing_codes" ADD CONSTRAINT "credential_pairing_codes_consumed_by_session_id_sessions_id_fk" FOREIGN KEY ("consumed_by_session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "credential_pairing_codes_code_unique" ON "credential_pairing_codes" USING btree ("code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credential_pairing_codes_source_session_purpose_idx" ON "credential_pairing_codes" USING btree ("source_session_id","purpose");
