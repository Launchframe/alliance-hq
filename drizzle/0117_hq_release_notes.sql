CREATE TABLE IF NOT EXISTS "hq_release_notes" (
  "version" text PRIMARY KEY NOT NULL,
  "title" text NOT NULL,
  "summary" text NOT NULL,
  "body_markdown" text NOT NULL,
  "breaking" jsonb,
  "maintainer_notes" jsonb,
  "shipped_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
