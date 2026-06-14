CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text,
	"alliance_id" text,
	"action" text NOT NULL,
	"resource_type" text,
	"resource_name" text,
	"resource_id" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parse_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"session_id" text NOT NULL,
	"score_target" text NOT NULL,
	"alliance_id" text,
	"row_count" integer DEFAULT 0 NOT NULL,
	"matched_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parsed_rows" (
	"id" text PRIMARY KEY NOT NULL,
	"parse_session_id" text NOT NULL,
	"ocr_name" text NOT NULL,
	"score" text NOT NULL,
	"rank" integer,
	"member_id" text,
	"member_name" text,
	"match_confidence" double precision,
	"match_method" text,
	"frame_index" integer,
	"deleted" integer DEFAULT 0 NOT NULL,
	"edited" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scroll_profiles" (
	"session_id" text PRIMARY KEY NOT NULL,
	"sample_interval_ms" integer DEFAULT 500 NOT NULL,
	"rows_per_frame" integer,
	"job_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_frames" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"frame_index" integer NOT NULL,
	"storage_key" text NOT NULL,
	"ssim_score" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "alliance_id" text;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD COLUMN "score_target" text;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD COLUMN "storage_key" text;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD COLUMN "alliance_id" text;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD COLUMN "parse_session_id" text;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD COLUMN "ingest_method" text DEFAULT 'video' NOT NULL;--> statement-breakpoint
ALTER TABLE "parse_sessions" ADD CONSTRAINT "parse_sessions_job_id_video_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."video_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parse_sessions" ADD CONSTRAINT "parse_sessions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parsed_rows" ADD CONSTRAINT "parsed_rows_parse_session_id_parse_sessions_id_fk" FOREIGN KEY ("parse_session_id") REFERENCES "public"."parse_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scroll_profiles" ADD CONSTRAINT "scroll_profiles_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_frames" ADD CONSTRAINT "video_frames_job_id_video_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."video_jobs"("id") ON DELETE cascade ON UPDATE no action;