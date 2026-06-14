ALTER TABLE "video_jobs" ADD COLUMN IF NOT EXISTS "board_key" text;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD COLUMN IF NOT EXISTS "commendation_id" text;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD COLUMN IF NOT EXISTS "hq_event_id" text;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hq_event_series" (
	"id" text PRIMARY KEY NOT NULL,
	"alliance_id" text NOT NULL,
	"score_target" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"score_type" text,
	"ashed_series_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hq_events" (
	"id" text PRIMARY KEY NOT NULL,
	"series_id" text,
	"alliance_id" text NOT NULL,
	"score_target" text NOT NULL,
	"name" text NOT NULL,
	"start_date" text,
	"end_date" text,
	"status" text DEFAULT 'active' NOT NULL,
	"ashed_event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hq_commendations" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hq_commendations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hq_event_boards" (
	"id" text PRIMARY KEY NOT NULL,
	"hq_event_id" text NOT NULL,
	"board_key" text NOT NULL,
	"name" text,
	"score_type" text,
	"commendation_id" text,
	"ashed_event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hq_event_members" (
	"id" text PRIMARY KEY NOT NULL,
	"hq_event_id" text NOT NULL,
	"member_id" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hq_events" ADD CONSTRAINT "hq_events_series_id_hq_event_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."hq_event_series"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hq_event_boards" ADD CONSTRAINT "hq_event_boards_hq_event_id_hq_events_id_fk" FOREIGN KEY ("hq_event_id") REFERENCES "public"."hq_events"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hq_event_boards" ADD CONSTRAINT "hq_event_boards_commendation_id_hq_commendations_id_fk" FOREIGN KEY ("commendation_id") REFERENCES "public"."hq_commendations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hq_event_members" ADD CONSTRAINT "hq_event_members_hq_event_id_hq_events_id_fk" FOREIGN KEY ("hq_event_id") REFERENCES "public"."hq_events"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
