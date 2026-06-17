CREATE TABLE IF NOT EXISTS "alliance_members" (
	"id" text PRIMARY KEY NOT NULL,
	"alliance_id" text NOT NULL,
	"ashed_member_id" text NOT NULL,
	"ashed_alliance_id" text NOT NULL,
	"current_name" text NOT NULL,
	"previous_names_json" jsonb,
	"status" text DEFAULT 'active' NOT NULL,
	"alliance_rank" integer,
	"alliance_rank_title" text,
	"ashed_rank_raw" text,
	"synced_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alliance_members_alliance_ashed_member_unique" UNIQUE("alliance_id","ashed_member_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alliance_members" ADD CONSTRAINT "alliance_members_alliance_id_alliances_id_fk" FOREIGN KEY ("alliance_id") REFERENCES "public"."alliances"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alliance_members_alliance_id_idx" ON "alliance_members" ("alliance_id");
