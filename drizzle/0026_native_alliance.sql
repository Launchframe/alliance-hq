ALTER TABLE "alliances" ADD COLUMN IF NOT EXISTS "operating_mode" text DEFAULT 'ashed' NOT NULL;
--> statement-breakpoint
ALTER TABLE "alliances" ADD COLUMN IF NOT EXISTS "owner_hq_user_id" text;
--> statement-breakpoint
ALTER TABLE "alliances" ADD COLUMN IF NOT EXISTS "owner_member_external_id" text;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alliances" ADD CONSTRAINT "alliances_owner_hq_user_id_hq_users_id_fk" FOREIGN KEY ("owner_hq_user_id") REFERENCES "public"."hq_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "alliance_members" ADD COLUMN IF NOT EXISTS "hero_power_m" double precision;
--> statement-breakpoint
ALTER TABLE "alliance_members" ADD COLUMN IF NOT EXISTS "member_level" integer;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hq_invites" (
	"id" text PRIMARY KEY NOT NULL,
	"alliance_id" text NOT NULL,
	"email" text NOT NULL,
	"role_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by_hq_user_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by_hq_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hq_invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hq_invites" ADD CONSTRAINT "hq_invites_alliance_id_alliances_id_fk" FOREIGN KEY ("alliance_id") REFERENCES "public"."alliances"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hq_invites" ADD CONSTRAINT "hq_invites_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hq_invites" ADD CONSTRAINT "hq_invites_invited_by_hq_user_id_hq_users_id_fk" FOREIGN KEY ("invited_by_hq_user_id") REFERENCES "public"."hq_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hq_invites" ADD CONSTRAINT "hq_invites_accepted_by_hq_user_id_hq_users_id_fk" FOREIGN KEY ("accepted_by_hq_user_id") REFERENCES "public"."hq_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hq_invites_alliance_id_idx" ON "hq_invites" ("alliance_id");
