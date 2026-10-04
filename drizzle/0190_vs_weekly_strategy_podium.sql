CREATE TABLE "vs_match_day_results" (
	"id" text PRIMARY KEY NOT NULL,
	"alliance_id" text NOT NULL,
	"matchup_id" text NOT NULL,
	"recorded_date" text NOT NULL,
	"our_score" numeric(30, 0),
	"opponent_score" numeric(30, 0),
	"outcome" text DEFAULT 'pending' NOT NULL,
	"finality" text DEFAULT 'unconfirmed' NOT NULL,
	"source" text DEFAULT 'hq_manual' NOT NULL,
	"source_ref" text,
	"hq_confirmed" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"recorded_by_hq_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vs_match_day_results_matchup_date_unique" UNIQUE("matchup_id","recorded_date")
);
--> statement-breakpoint
CREATE TABLE "vs_match_observations" (
	"id" text PRIMARY KEY NOT NULL,
	"alliance_id" text NOT NULL,
	"matchup_id" text NOT NULL,
	"recorded_date" text NOT NULL,
	"source" text NOT NULL,
	"source_ref" text,
	"request_id" text NOT NULL,
	"content_hash" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"native_version" integer DEFAULT 0 NOT NULL,
	"disposition" text DEFAULT 'applied' NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_hq_user_id" text,
	CONSTRAINT "vs_match_observations_request_unique" UNIQUE("matchup_id","recorded_date","request_id")
);
--> statement-breakpoint
CREATE TABLE "vs_matchups" (
	"id" text PRIMARY KEY NOT NULL,
	"alliance_id" text NOT NULL,
	"week_start" text NOT NULL,
	"opponent_name" text,
	"opponent_tag" text,
	"external_opponent_id" text,
	"external_competition_id" text,
	"identity_source" text DEFAULT 'hq_manual' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_hq_user_id" text,
	"updated_by_hq_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vs_matchups_alliance_week_unique" UNIQUE("alliance_id","week_start")
);
--> statement-breakpoint
CREATE TABLE "vs_strategy_preferences" (
	"alliance_id" text PRIMARY KEY NOT NULL,
	"push_defaults" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by_hq_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vs_week_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"alliance_id" text NOT NULL,
	"week_start" text NOT NULL,
	"platform" text NOT NULL,
	"days" jsonb NOT NULL,
	"lead_days" integer DEFAULT 0 NOT NULL,
	"applied_meta" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_hq_user_id" text,
	"updated_by_hq_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vs_week_plans_alliance_week_unique" UNIQUE("alliance_id","week_start")
);
--> statement-breakpoint
ALTER TABLE "vs_match_day_results" ADD CONSTRAINT "vs_match_day_results_alliance_id_alliances_id_fk" FOREIGN KEY ("alliance_id") REFERENCES "public"."alliances"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vs_match_day_results" ADD CONSTRAINT "vs_match_day_results_matchup_id_vs_matchups_id_fk" FOREIGN KEY ("matchup_id") REFERENCES "public"."vs_matchups"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vs_match_day_results" ADD CONSTRAINT "vs_match_day_results_recorded_by_hq_user_id_hq_users_id_fk" FOREIGN KEY ("recorded_by_hq_user_id") REFERENCES "public"."hq_users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vs_match_observations" ADD CONSTRAINT "vs_match_observations_alliance_id_alliances_id_fk" FOREIGN KEY ("alliance_id") REFERENCES "public"."alliances"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vs_match_observations" ADD CONSTRAINT "vs_match_observations_matchup_id_vs_matchups_id_fk" FOREIGN KEY ("matchup_id") REFERENCES "public"."vs_matchups"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vs_match_observations" ADD CONSTRAINT "vs_match_observations_actor_hq_user_id_hq_users_id_fk" FOREIGN KEY ("actor_hq_user_id") REFERENCES "public"."hq_users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vs_matchups" ADD CONSTRAINT "vs_matchups_alliance_id_alliances_id_fk" FOREIGN KEY ("alliance_id") REFERENCES "public"."alliances"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vs_matchups" ADD CONSTRAINT "vs_matchups_created_by_hq_user_id_hq_users_id_fk" FOREIGN KEY ("created_by_hq_user_id") REFERENCES "public"."hq_users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vs_matchups" ADD CONSTRAINT "vs_matchups_updated_by_hq_user_id_hq_users_id_fk" FOREIGN KEY ("updated_by_hq_user_id") REFERENCES "public"."hq_users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vs_strategy_preferences" ADD CONSTRAINT "vs_strategy_preferences_alliance_id_alliances_id_fk" FOREIGN KEY ("alliance_id") REFERENCES "public"."alliances"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vs_strategy_preferences" ADD CONSTRAINT "vs_strategy_preferences_updated_by_hq_user_id_hq_users_id_fk" FOREIGN KEY ("updated_by_hq_user_id") REFERENCES "public"."hq_users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vs_week_plans" ADD CONSTRAINT "vs_week_plans_alliance_id_alliances_id_fk" FOREIGN KEY ("alliance_id") REFERENCES "public"."alliances"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vs_week_plans" ADD CONSTRAINT "vs_week_plans_created_by_hq_user_id_hq_users_id_fk" FOREIGN KEY ("created_by_hq_user_id") REFERENCES "public"."hq_users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vs_week_plans" ADD CONSTRAINT "vs_week_plans_updated_by_hq_user_id_hq_users_id_fk" FOREIGN KEY ("updated_by_hq_user_id") REFERENCES "public"."hq_users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "vs_match_day_results_alliance_idx" ON "vs_match_day_results" USING btree ("alliance_id","recorded_date");
--> statement-breakpoint
CREATE INDEX "vs_match_observations_matchup_idx" ON "vs_match_observations" USING btree ("matchup_id","recorded_date");
