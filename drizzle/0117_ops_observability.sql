-- Ops observability: cron run history and alert events.

CREATE TABLE IF NOT EXISTS "ops_events" (
  "id" text PRIMARY KEY NOT NULL,
  "severity" text NOT NULL,
  "source" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "fingerprint" text,
  "sentry_event_id" text,
  "channel_status" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ops_events_severity_created_at_idx" ON "ops_events" ("severity", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ops_events_fingerprint_created_at_idx" ON "ops_events" ("fingerprint", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ops_events_created_at_idx" ON "ops_events" ("created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cron_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone,
  "status" text NOT NULL,
  "error_class" text,
  "error_message" text,
  "processed" integer,
  "duration_ms" integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cron_runs_name_started_at_idx" ON "cron_runs" ("name", "started_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cron_runs_status_idx" ON "cron_runs" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cron_runs_started_at_idx" ON "cron_runs" ("started_at");
