CREATE TABLE IF NOT EXISTS "ashed_credential_shares" (
	"id" text PRIMARY KEY NOT NULL,
	"alliance_id" text NOT NULL,
	"owner_hq_user_id" text NOT NULL,
	"delegate_hq_user_id" text,
	"invited_hq_user_id" text NOT NULL,
	"status" text NOT NULL,
	"capabilities" jsonb NOT NULL DEFAULT '[]'::jsonb,
	"encrypted_token" text,
	"app_id" text,
	"origin_url" text,
	"token_expires_at" timestamp with time zone,
	"ashed_user_id" text,
	"expires_at" timestamp with time zone,
	"end_reason" text,
	"invite_token_hash" text,
	"last_accessed_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ashed_credential_shares" ADD CONSTRAINT "ashed_credential_shares_alliance_id_alliances_id_fk" FOREIGN KEY ("alliance_id") REFERENCES "public"."alliances"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ashed_credential_shares" ADD CONSTRAINT "ashed_credential_shares_owner_hq_user_id_hq_users_id_fk" FOREIGN KEY ("owner_hq_user_id") REFERENCES "public"."hq_users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ashed_credential_shares" ADD CONSTRAINT "ashed_credential_shares_delegate_hq_user_id_hq_users_id_fk" FOREIGN KEY ("delegate_hq_user_id") REFERENCES "public"."hq_users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ashed_credential_shares" ADD CONSTRAINT "ashed_credential_shares_invited_hq_user_id_hq_users_id_fk" FOREIGN KEY ("invited_hq_user_id") REFERENCES "public"."hq_users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ashed_credential_shares_alliance_status" ON "ashed_credential_shares" ("alliance_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ashed_credential_shares_delegate_active" ON "ashed_credential_shares" ("alliance_id", "delegate_hq_user_id") WHERE "status" = 'active';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_ashed_credential_shares_owner_active" ON "ashed_credential_shares" ("alliance_id", "owner_hq_user_id") WHERE "status" = 'active';
