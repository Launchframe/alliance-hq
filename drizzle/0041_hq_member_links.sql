CREATE TABLE IF NOT EXISTS "hq_member_links" (
	"id" text PRIMARY KEY NOT NULL,
	"alliance_id" text NOT NULL,
	"hq_user_id" text NOT NULL,
	"ashed_member_id" text NOT NULL,
	"member_display_name" text,
	"game_uid" text NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hq_member_links" ADD CONSTRAINT "hq_member_links_alliance_id_alliances_id_fk" FOREIGN KEY ("alliance_id") REFERENCES "public"."alliances"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hq_member_links" ADD CONSTRAINT "hq_member_links_hq_user_id_hq_users_id_fk" FOREIGN KEY ("hq_user_id") REFERENCES "public"."hq_users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hq_member_links_alliance_user_unique" ON "hq_member_links" ("alliance_id","hq_user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hq_member_links_alliance_member_unique" ON "hq_member_links" ("alliance_id","ashed_member_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hq_member_link_pending" (
	"alliance_id" text NOT NULL,
	"hq_user_id" text NOT NULL,
	"pending_json" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hq_member_link_pending_alliance_user_pk" PRIMARY KEY("alliance_id","hq_user_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hq_member_link_pending" ADD CONSTRAINT "hq_member_link_pending_alliance_id_alliances_id_fk" FOREIGN KEY ("alliance_id") REFERENCES "public"."alliances"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hq_member_link_pending" ADD CONSTRAINT "hq_member_link_pending_hq_user_id_hq_users_id_fk" FOREIGN KEY ("hq_user_id") REFERENCES "public"."hq_users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
