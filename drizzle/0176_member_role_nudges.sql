CREATE TABLE IF NOT EXISTS "member_role_nudges" (
	"id" text PRIMARY KEY NOT NULL,
	"alliance_id" text NOT NULL,
	"ashed_member_id" text NOT NULL,
	"hq_user_id" text,
	"kind" text NOT NULL,
	"from_rank" integer,
	"to_rank" integer,
	"rank_event_id" text,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_by_hq_user_id" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "alliance_membership_role_events" (
	"id" text PRIMARY KEY NOT NULL,
	"alliance_id" text NOT NULL,
	"hq_user_id" text NOT NULL,
	"from_role_id" text,
	"to_role_id" text NOT NULL,
	"source" text NOT NULL,
	"actor_hq_user_id" text,
	"nudge_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "member_role_nudges" ADD CONSTRAINT "member_role_nudges_alliance_id_alliances_id_fk" FOREIGN KEY ("alliance_id") REFERENCES "public"."alliances"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "member_role_nudges" ADD CONSTRAINT "member_role_nudges_hq_user_id_hq_users_id_fk" FOREIGN KEY ("hq_user_id") REFERENCES "public"."hq_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "member_role_nudges" ADD CONSTRAINT "member_role_nudges_rank_event_id_member_alliance_rank_events_id_fk" FOREIGN KEY ("rank_event_id") REFERENCES "public"."member_alliance_rank_events"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "member_role_nudges" ADD CONSTRAINT "member_role_nudges_resolved_by_hq_user_id_hq_users_id_fk" FOREIGN KEY ("resolved_by_hq_user_id") REFERENCES "public"."hq_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alliance_membership_role_events" ADD CONSTRAINT "alliance_membership_role_events_alliance_id_alliances_id_fk" FOREIGN KEY ("alliance_id") REFERENCES "public"."alliances"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alliance_membership_role_events" ADD CONSTRAINT "alliance_membership_role_events_hq_user_id_hq_users_id_fk" FOREIGN KEY ("hq_user_id") REFERENCES "public"."hq_users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alliance_membership_role_events" ADD CONSTRAINT "alliance_membership_role_events_from_role_id_roles_id_fk" FOREIGN KEY ("from_role_id") REFERENCES "public"."roles"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alliance_membership_role_events" ADD CONSTRAINT "alliance_membership_role_events_to_role_id_roles_id_fk" FOREIGN KEY ("to_role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alliance_membership_role_events" ADD CONSTRAINT "alliance_membership_role_events_actor_hq_user_id_hq_users_id_fk" FOREIGN KEY ("actor_hq_user_id") REFERENCES "public"."hq_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alliance_membership_role_events" ADD CONSTRAINT "alliance_membership_role_events_nudge_id_member_role_nudges_id_fk" FOREIGN KEY ("nudge_id") REFERENCES "public"."member_role_nudges"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "member_role_nudges_open_unique"
  ON "member_role_nudges" ("alliance_id", "ashed_member_id", "kind")
  WHERE "status" = 'open';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "member_role_nudges_alliance_created_idx"
  ON "member_role_nudges" ("alliance_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alliance_membership_role_events_alliance_created_idx"
  ON "alliance_membership_role_events" ("alliance_id", "created_at" DESC);
