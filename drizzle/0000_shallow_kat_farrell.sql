CREATE TABLE "ashed_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"app_id" text NOT NULL,
	"origin_url" text NOT NULL,
	"encrypted_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"status" text NOT NULL,
	"file_name" text,
	"file_size_bytes" integer,
	"category" text,
	"frame_count" integer,
	"uploaded_frame_count" integer,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ashed_credentials" ADD CONSTRAINT "ashed_credentials_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD CONSTRAINT "video_jobs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;