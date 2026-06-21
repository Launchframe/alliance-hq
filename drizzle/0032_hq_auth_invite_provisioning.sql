ALTER TABLE "hq_users" ADD COLUMN IF NOT EXISTS "email_verified_at" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "auth_verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
ALTER TABLE "hq_invites" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'email' NOT NULL;
--> statement-breakpoint
ALTER TABLE "hq_invites" ALTER COLUMN "email" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "hq_invites" ADD COLUMN IF NOT EXISTS "passphrase_hash" text;
--> statement-breakpoint
ALTER TABLE "hq_invites" ADD COLUMN IF NOT EXISTS "passphrase_consumed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "hq_invites" ADD COLUMN IF NOT EXISTS "admin_label" text;
--> statement-breakpoint
ALTER TABLE "hq_invites" ADD COLUMN IF NOT EXISTS "target_discord_user_id" text;
--> statement-breakpoint
ALTER TABLE "hq_invites" ADD COLUMN IF NOT EXISTS "require_member_link" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE "hq_invites" SET "kind" = 'email' WHERE "kind" IS NULL OR "kind" = '';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hq_alliance_join_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"alliance_id" text NOT NULL,
	"role_id" text NOT NULL,
	"code_hash" text NOT NULL,
	"code_hint" text NOT NULL,
	"max_redemptions" integer NOT NULL,
	"redemption_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"admin_label" text,
	"created_by_hq_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hq_alliance_join_codes_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hq_alliance_join_code_redemptions" (
	"id" text PRIMARY KEY NOT NULL,
	"join_code_id" text NOT NULL,
	"hq_user_id" text NOT NULL,
	"redeemed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hq_alliance_join_code_redemptions_join_user_unique" UNIQUE("join_code_id","hq_user_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hq_alliance_join_codes" ADD CONSTRAINT "hq_alliance_join_codes_alliance_id_alliances_id_fk" FOREIGN KEY ("alliance_id") REFERENCES "public"."alliances"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hq_alliance_join_codes" ADD CONSTRAINT "hq_alliance_join_codes_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hq_alliance_join_codes" ADD CONSTRAINT "hq_alliance_join_codes_created_by_hq_user_id_hq_users_id_fk" FOREIGN KEY ("created_by_hq_user_id") REFERENCES "public"."hq_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hq_alliance_join_code_redemptions" ADD CONSTRAINT "hq_alliance_join_code_redemptions_join_code_id_fk" FOREIGN KEY ("join_code_id") REFERENCES "public"."hq_alliance_join_codes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hq_alliance_join_code_redemptions" ADD CONSTRAINT "hq_alliance_join_code_redemptions_hq_user_id_fk" FOREIGN KEY ("hq_user_id") REFERENCES "public"."hq_users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
