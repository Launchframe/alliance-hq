ALTER TABLE "hq_users" ADD COLUMN IF NOT EXISTS "password_hash" text;

CREATE TABLE IF NOT EXISTS "hq_authenticators" (
	"credential_id" text NOT NULL,
	"hq_user_id" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"credential_public_key" text NOT NULL,
	"counter" integer NOT NULL,
	"credential_device_type" text NOT NULL,
	"credential_backed_up" boolean NOT NULL,
	"transports" text,
	CONSTRAINT "hq_authenticators_hq_user_id_credential_id_pk" PRIMARY KEY("hq_user_id","credential_id"),
	CONSTRAINT "hq_authenticators_credential_id_unique" UNIQUE("credential_id")
);

DO $$ BEGIN
 ALTER TABLE "hq_authenticators" ADD CONSTRAINT "hq_authenticators_hq_user_id_hq_users_id_fk" FOREIGN KEY ("hq_user_id") REFERENCES "public"."hq_users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
