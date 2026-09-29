CREATE TABLE "vs_capture_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"alliance_id" text NOT NULL,
	"created_by_hq_user_id" text,
	"kind" text NOT NULL,
	"image_sha256" text NOT NULL,
	"candidate" jsonb NOT NULL,
	"status" text DEFAULT 'review' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_request_id" text,
	"completed_body_hash" text,
	"completed_result" jsonb,
	CONSTRAINT "vs_capture_reviews_kind_check" CHECK ("vs_capture_reviews"."kind" in ('weekly_overview', 'daily_totals')),
	CONSTRAINT "vs_capture_reviews_status_check" CHECK ("vs_capture_reviews"."status" in ('review', 'complete')),
	CONSTRAINT "vs_capture_reviews_version_check" CHECK ("vs_capture_reviews"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "vs_matchup_ashed_sync" (
	"matchup_id" text NOT NULL,
	"alliance_id" text NOT NULL,
	"baseline_snapshot" jsonb,
	"observed_snapshot" jsonb,
	"dirty_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"conflict_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"requested_version" integer DEFAULT 0 NOT NULL,
	"processed_version" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"error_code" text,
	"lease_token" text,
	"lease_expires_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vs_matchup_ashed_sync_pk" PRIMARY KEY("matchup_id","alliance_id"),
	CONSTRAINT "vs_matchup_ashed_sync_status_check" CHECK ("vs_matchup_ashed_sync"."status" in ('idle', 'pending', 'synced', 'conflict', 'credentials_required', 'failed', 'uncertain')),
	CONSTRAINT "vs_matchup_ashed_sync_dirty_fields_check" CHECK (jsonb_typeof("vs_matchup_ashed_sync"."dirty_fields") = 'array' and "vs_matchup_ashed_sync"."dirty_fields" <@ '["day:1","day:2","day:3","day:4","day:5","day:6","opponentName","opponentServer","opponentTag","weekOutcome"]'::jsonb),
	CONSTRAINT "vs_matchup_ashed_sync_conflict_fields_check" CHECK (jsonb_typeof("vs_matchup_ashed_sync"."conflict_fields") = 'array' and "vs_matchup_ashed_sync"."conflict_fields" <@ '["day:1","day:2","day:3","day:4","day:5","day:6","opponentName","opponentServer","opponentTag","weekOutcome"]'::jsonb),
	CONSTRAINT "vs_matchup_ashed_sync_versions_check" CHECK ("vs_matchup_ashed_sync"."requested_version" >= 0 and "vs_matchup_ashed_sync"."processed_version" >= 0)
);
--> statement-breakpoint
ALTER TABLE "vs_matchups" ADD COLUMN "opponent_server" integer;--> statement-breakpoint
ALTER TABLE "vs_matchups" ADD COLUMN "opponent_daily_scores" jsonb DEFAULT '[null,null,null,null,null,null]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "vs_matchups" ADD COLUMN "week_outcome" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "vs_matchups" ADD COLUMN "opponent_info_owned_fields" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "vs_matchups" ADD COLUMN "reported_our_points" integer;--> statement-breakpoint
ALTER TABLE "vs_matchups" ADD COLUMN "reported_opponent_points" integer;--> statement-breakpoint
ALTER TABLE "vs_matchups" ADD COLUMN "reported_points_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vs_capture_reviews" ADD CONSTRAINT "vs_capture_reviews_alliance_id_alliances_id_fk" FOREIGN KEY ("alliance_id") REFERENCES "public"."alliances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vs_capture_reviews" ADD CONSTRAINT "vs_capture_reviews_created_by_hq_user_id_hq_users_id_fk" FOREIGN KEY ("created_by_hq_user_id") REFERENCES "public"."hq_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vs_matchup_ashed_sync" ADD CONSTRAINT "vs_matchup_ashed_sync_matchup_alliance_fk" FOREIGN KEY ("matchup_id","alliance_id") REFERENCES "public"."vs_matchups"("id","alliance_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vs_capture_reviews_alliance_idx" ON "vs_capture_reviews" USING btree ("alliance_id","created_at");--> statement-breakpoint
CREATE INDEX "vs_capture_reviews_expires_idx" ON "vs_capture_reviews" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "vs_matchup_ashed_sync_alliance_idx" ON "vs_matchup_ashed_sync" USING btree ("alliance_id");--> statement-breakpoint
ALTER TABLE "vs_matchups" ADD CONSTRAINT "vs_matchups_week_outcome_check" CHECK ("vs_matchups"."week_outcome" in ('pending', 'win', 'loss'));--> statement-breakpoint
ALTER TABLE "vs_matchups" ADD CONSTRAINT "vs_matchups_opponent_scores_check" CHECK (jsonb_typeof("vs_matchups"."opponent_daily_scores") = 'array' and jsonb_array_length("vs_matchups"."opponent_daily_scores") = 6 and ("vs_matchups"."opponent_daily_scores"->0 is null or jsonb_typeof("vs_matchups"."opponent_daily_scores"->0) = 'null' or (jsonb_typeof("vs_matchups"."opponent_daily_scores"->0) = 'string' and ("vs_matchups"."opponent_daily_scores"->>0) ~ '^(0|[1-9][0-9]{0,29})$')) and ("vs_matchups"."opponent_daily_scores"->1 is null or jsonb_typeof("vs_matchups"."opponent_daily_scores"->1) = 'null' or (jsonb_typeof("vs_matchups"."opponent_daily_scores"->1) = 'string' and ("vs_matchups"."opponent_daily_scores"->>1) ~ '^(0|[1-9][0-9]{0,29})$')) and ("vs_matchups"."opponent_daily_scores"->2 is null or jsonb_typeof("vs_matchups"."opponent_daily_scores"->2) = 'null' or (jsonb_typeof("vs_matchups"."opponent_daily_scores"->2) = 'string' and ("vs_matchups"."opponent_daily_scores"->>2) ~ '^(0|[1-9][0-9]{0,29})$')) and ("vs_matchups"."opponent_daily_scores"->3 is null or jsonb_typeof("vs_matchups"."opponent_daily_scores"->3) = 'null' or (jsonb_typeof("vs_matchups"."opponent_daily_scores"->3) = 'string' and ("vs_matchups"."opponent_daily_scores"->>3) ~ '^(0|[1-9][0-9]{0,29})$')) and ("vs_matchups"."opponent_daily_scores"->4 is null or jsonb_typeof("vs_matchups"."opponent_daily_scores"->4) = 'null' or (jsonb_typeof("vs_matchups"."opponent_daily_scores"->4) = 'string' and ("vs_matchups"."opponent_daily_scores"->>4) ~ '^(0|[1-9][0-9]{0,29})$')) and ("vs_matchups"."opponent_daily_scores"->5 is null or jsonb_typeof("vs_matchups"."opponent_daily_scores"->5) = 'null' or (jsonb_typeof("vs_matchups"."opponent_daily_scores"->5) = 'string' and ("vs_matchups"."opponent_daily_scores"->>5) ~ '^(0|[1-9][0-9]{0,29})$')));--> statement-breakpoint
ALTER TABLE "vs_matchups" ADD CONSTRAINT "vs_matchups_reported_points_check" CHECK (("vs_matchups"."reported_our_points" is null) = ("vs_matchups"."reported_opponent_points" is null) and ("vs_matchups"."reported_our_points" is null or ("vs_matchups"."reported_our_points" between 0 and 13 and "vs_matchups"."reported_opponent_points" between 0 and 13 and "vs_matchups"."reported_our_points" + "vs_matchups"."reported_opponent_points" <= 13)));--> statement-breakpoint
ALTER TABLE "vs_matchups" ADD CONSTRAINT "vs_matchups_owned_fields_check" CHECK (jsonb_typeof("vs_matchups"."opponent_info_owned_fields") = 'array' and "vs_matchups"."opponent_info_owned_fields" <@ '["day:1","day:2","day:3","day:4","day:5","day:6","opponentName","opponentServer","opponentTag","weekOutcome"]'::jsonb);
--> statement-breakpoint
WITH projected AS (
  SELECT m.id, m.alliance_id,
    jsonb_agg(
      CASE WHEN r.hq_confirmed = 1 AND r.finality = 'final' AND r.opponent_score IS NOT NULL
        THEN to_jsonb(r.opponent_score::text)
        ELSE m.opponent_daily_scores -> d.i END
      ORDER BY d.i
    ) AS scores,
    coalesce(jsonb_agg(to_jsonb('day:' || (d.i + 1)::text) ORDER BY d.i)
      FILTER (WHERE r.hq_confirmed = 1 AND r.finality = 'final' AND r.opponent_score IS NOT NULL), '[]'::jsonb) AS owned_days
  FROM vs_matchups m
  CROSS JOIN generate_series(0, 5) AS d(i)
  LEFT JOIN vs_match_day_results r
    ON r.matchup_id = m.id AND r.alliance_id = m.alliance_id
    AND r.recorded_date::date = m.week_start::date + d.i
  GROUP BY m.id, m.alliance_id
)
UPDATE vs_matchups m
SET opponent_daily_scores = p.scores,
    opponent_info_owned_fields = (
      SELECT coalesce(jsonb_agg(to_jsonb(field) ORDER BY field), '[]'::jsonb)
      FROM (
        SELECT DISTINCT value AS field
        FROM jsonb_array_elements_text(
          m.opponent_info_owned_fields || p.owned_days ||
          CASE WHEN m.identity_source = 'hq_manual'
            THEN '["opponentName","opponentTag"]'::jsonb ELSE '[]'::jsonb END
        )
      ) AS owned
    )
FROM projected p
WHERE m.id = p.id AND m.alliance_id = p.alliance_id;
