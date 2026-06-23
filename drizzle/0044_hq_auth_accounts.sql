CREATE TABLE IF NOT EXISTS "hq_auth_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"hq_user_id" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	CONSTRAINT "hq_auth_accounts_provider_account_unique" UNIQUE("provider","provider_account_id")
);

DO $$ BEGIN
 ALTER TABLE "hq_auth_accounts" ADD CONSTRAINT "hq_auth_accounts_hq_user_id_hq_users_id_fk" FOREIGN KEY ("hq_user_id") REFERENCES "public"."hq_users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
