CREATE TABLE IF NOT EXISTS "linked_devices" (
	"id" text PRIMARY KEY NOT NULL,
	"hq_user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"pairing_code_id" text,
	"device_name" text NOT NULL,
	"user_agent" text,
	"os_label" text,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_access_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "linked_devices" ADD CONSTRAINT "linked_devices_hq_user_id_hq_users_id_fk" FOREIGN KEY ("hq_user_id") REFERENCES "public"."hq_users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "linked_devices" ADD CONSTRAINT "linked_devices_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "linked_devices" ADD CONSTRAINT "linked_devices_pairing_code_id_credential_pairing_codes_id_fk" FOREIGN KEY ("pairing_code_id") REFERENCES "public"."credential_pairing_codes"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "linked_devices_session_id_unique" ON "linked_devices" USING btree ("session_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "linked_devices_hq_user_active_idx" ON "linked_devices" USING btree ("hq_user_id") WHERE "revoked_at" IS NULL;
