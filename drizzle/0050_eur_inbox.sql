-- EUR (event upload reminders) + officer inbox items

CREATE TABLE IF NOT EXISTS "eur_schedule_rules" (
  "id" text PRIMARY KEY NOT NULL,
  "alliance_id" text NOT NULL REFERENCES "alliances"("id") ON DELETE cascade,
  "score_target" text,
  "custom_label" text,
  "schedule_kind" text NOT NULL,
  "weekly_slots" jsonb,
  "interval_days" integer,
  "anchor_time_st" text,
  "reminder_delay_minutes" integer DEFAULT 60 NOT NULL,
  "active" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "eur_occurrences" (
  "id" text PRIMARY KEY NOT NULL,
  "schedule_rule_id" text NOT NULL REFERENCES "eur_schedule_rules"("id") ON DELETE cascade,
  "alliance_id" text NOT NULL REFERENCES "alliances"("id") ON DELETE cascade,
  "score_target" text,
  "custom_label" text,
  "occurrence_date" text NOT NULL,
  "scheduled_start_at" timestamp with time zone NOT NULL,
  "reminder_at" timestamp with time zone NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "satisfied_at" timestamp with time zone,
  "satisfied_by_job_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "eur_occurrences_rule_start_unique" UNIQUE("schedule_rule_id","scheduled_start_at")
);

CREATE TABLE IF NOT EXISTS "eur_user_subscriptions" (
  "id" text PRIMARY KEY NOT NULL,
  "hq_user_id" text NOT NULL REFERENCES "hq_users"("id") ON DELETE cascade,
  "alliance_id" text NOT NULL REFERENCES "alliances"("id") ON DELETE cascade,
  "score_target" text NOT NULL,
  "cadence" text NOT NULL,
  "cadence_config" jsonb,
  "reminder_delay_minutes" integer DEFAULT 0 NOT NULL,
  "next_due_at" timestamp with time zone,
  "active" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "eur_user_subscriptions_user_alliance_target" UNIQUE("hq_user_id","alliance_id","score_target")
);

CREATE TABLE IF NOT EXISTS "inbox_reminder_items" (
  "id" text PRIMARY KEY NOT NULL,
  "alliance_id" text NOT NULL REFERENCES "alliances"("id") ON DELETE cascade,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "body" text,
  "href" text,
  "score_target" text,
  "eur_occurrence_id" text REFERENCES "eur_occurrences"("id") ON DELETE cascade,
  "eur_subscription_id" text REFERENCES "eur_user_subscriptions"("id") ON DELETE cascade,
  "required_permission" text,
  "active" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "inbox_reminder_dismissals" (
  "id" text PRIMARY KEY NOT NULL,
  "hq_user_id" text NOT NULL REFERENCES "hq_users"("id") ON DELETE cascade,
  "item_id" text NOT NULL REFERENCES "inbox_reminder_items"("id") ON DELETE cascade,
  "dismissed_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "inbox_reminder_dismissals_user_item" UNIQUE("hq_user_id","item_id")
);
