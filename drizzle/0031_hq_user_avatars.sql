ALTER TABLE "hq_users" ADD COLUMN IF NOT EXISTS "avatar_url" text;
--> statement-breakpoint
ALTER TABLE "hq_users" ADD COLUMN IF NOT EXISTS "avatar_source" text;
--> statement-breakpoint
ALTER TABLE "hq_users" ADD COLUMN IF NOT EXISTS "avatar_refreshed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "hq_users" ADD COLUMN IF NOT EXISTS "primary_game_uid" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hq_user_auth_providers" (
	"id" text PRIMARY KEY NOT NULL,
	"hq_user_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_user_id" text NOT NULL,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hq_user_auth_providers_hq_user_provider_unique" UNIQUE("hq_user_id","provider")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hq_user_auth_providers" ADD CONSTRAINT "hq_user_auth_providers_hq_user_id_hq_users_id_fk" FOREIGN KEY ("hq_user_id") REFERENCES "public"."hq_users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
