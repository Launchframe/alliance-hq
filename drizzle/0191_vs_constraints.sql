ALTER TABLE "vs_match_day_results" DROP CONSTRAINT IF EXISTS "vs_match_day_results_matchup_id_vs_matchups_id_fk";
--> statement-breakpoint
ALTER TABLE "vs_match_observations" DROP CONSTRAINT IF EXISTS "vs_match_observations_matchup_id_vs_matchups_id_fk";
--> statement-breakpoint
ALTER TABLE "vs_match_observations" ALTER COLUMN "recorded_date" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "vs_match_day_results" ADD COLUMN IF NOT EXISTS "source_revision" text;--> statement-breakpoint
ALTER TABLE "vs_match_observations" ADD COLUMN IF NOT EXISTS "source_revision" text;--> statement-breakpoint
ALTER TABLE "vs_match_observations" ADD COLUMN IF NOT EXISTS "sequence" bigserial NOT NULL;--> statement-breakpoint
ALTER TABLE "vs_match_day_results" DROP CONSTRAINT IF EXISTS "vs_match_day_results_matchup_alliance_fk";
--> statement-breakpoint
ALTER TABLE "vs_match_observations" DROP CONSTRAINT IF EXISTS "vs_match_observations_matchup_alliance_fk";
--> statement-breakpoint
ALTER TABLE "vs_matchups" DROP CONSTRAINT IF EXISTS "vs_matchups_id_alliance_unique";
--> statement-breakpoint
ALTER TABLE "vs_matchups" ADD CONSTRAINT "vs_matchups_id_alliance_unique" UNIQUE("id","alliance_id");--> statement-breakpoint
ALTER TABLE "vs_match_day_results" ADD CONSTRAINT "vs_match_day_results_matchup_alliance_fk" FOREIGN KEY ("matchup_id","alliance_id") REFERENCES "public"."vs_matchups"("id","alliance_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vs_match_observations" ADD CONSTRAINT "vs_match_observations_matchup_alliance_fk" FOREIGN KEY ("matchup_id","alliance_id") REFERENCES "public"."vs_matchups"("id","alliance_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vs_match_day_results" DROP CONSTRAINT IF EXISTS "vs_match_day_results_scores_paired_check";
--> statement-breakpoint
ALTER TABLE "vs_match_day_results" ADD CONSTRAINT "vs_match_day_results_scores_paired_check" CHECK (("vs_match_day_results"."our_score" is null) = ("vs_match_day_results"."opponent_score" is null));--> statement-breakpoint
ALTER TABLE "vs_match_day_results" DROP CONSTRAINT IF EXISTS "vs_match_day_results_scores_nonnegative_check";
--> statement-breakpoint
ALTER TABLE "vs_match_day_results" ADD CONSTRAINT "vs_match_day_results_scores_nonnegative_check" CHECK ("vs_match_day_results"."our_score" >= 0 and "vs_match_day_results"."opponent_score" >= 0);--> statement-breakpoint
ALTER TABLE "vs_match_day_results" DROP CONSTRAINT IF EXISTS "vs_match_day_results_outcome_check";
--> statement-breakpoint
ALTER TABLE "vs_match_day_results" ADD CONSTRAINT "vs_match_day_results_outcome_check" CHECK ("vs_match_day_results"."outcome" in ('pending', 'won', 'lost'));--> statement-breakpoint
ALTER TABLE "vs_match_day_results" DROP CONSTRAINT IF EXISTS "vs_match_day_results_finality_check";
--> statement-breakpoint
ALTER TABLE "vs_match_day_results" ADD CONSTRAINT "vs_match_day_results_finality_check" CHECK ("vs_match_day_results"."finality" in ('unconfirmed', 'final'));--> statement-breakpoint
ALTER TABLE "vs_match_day_results" DROP CONSTRAINT IF EXISTS "vs_match_day_results_source_check";
--> statement-breakpoint
ALTER TABLE "vs_match_day_results" ADD CONSTRAINT "vs_match_day_results_source_check" CHECK ("vs_match_day_results"."source" in ('hq_manual', 'ashed_import', 'reviewed_upload'));--> statement-breakpoint
ALTER TABLE "vs_match_day_results" DROP CONSTRAINT IF EXISTS "vs_match_day_results_version_check";
--> statement-breakpoint
ALTER TABLE "vs_match_day_results" ADD CONSTRAINT "vs_match_day_results_version_check" CHECK ("vs_match_day_results"."version" > 0);--> statement-breakpoint
ALTER TABLE "vs_match_day_results" DROP CONSTRAINT IF EXISTS "vs_match_day_results_recorded_weekday_check";
--> statement-breakpoint
ALTER TABLE "vs_match_day_results" ADD CONSTRAINT "vs_match_day_results_recorded_weekday_check" CHECK (extract(isodow from "vs_match_day_results"."recorded_date"::date) between 1 and 6);--> statement-breakpoint
ALTER TABLE "vs_match_observations" DROP CONSTRAINT IF EXISTS "vs_match_observations_source_check";
--> statement-breakpoint
ALTER TABLE "vs_match_observations" ADD CONSTRAINT "vs_match_observations_source_check" CHECK ("vs_match_observations"."source" in ('hq_manual', 'ashed_import', 'reviewed_upload'));--> statement-breakpoint
ALTER TABLE "vs_match_observations" DROP CONSTRAINT IF EXISTS "vs_match_observations_disposition_check";
--> statement-breakpoint
ALTER TABLE "vs_match_observations" ADD CONSTRAINT "vs_match_observations_disposition_check" CHECK ("vs_match_observations"."disposition" in ('applied', 'conflict', 'reviewed_keep_hq', 'reviewed_use_ashed', 'superseded'));--> statement-breakpoint
ALTER TABLE "vs_match_observations" DROP CONSTRAINT IF EXISTS "vs_match_observations_recorded_weekday_check";
--> statement-breakpoint
ALTER TABLE "vs_match_observations" ADD CONSTRAINT "vs_match_observations_recorded_weekday_check" CHECK ("vs_match_observations"."recorded_date" is null or extract(isodow from "vs_match_observations"."recorded_date"::date) between 1 and 6);--> statement-breakpoint
ALTER TABLE "vs_matchups" DROP CONSTRAINT IF EXISTS "vs_matchups_week_start_monday_check";
--> statement-breakpoint
ALTER TABLE "vs_matchups" ADD CONSTRAINT "vs_matchups_week_start_monday_check" CHECK (extract(isodow from "vs_matchups"."week_start"::date) = 1);--> statement-breakpoint
ALTER TABLE "vs_matchups" DROP CONSTRAINT IF EXISTS "vs_matchups_version_check";
--> statement-breakpoint
ALTER TABLE "vs_matchups" ADD CONSTRAINT "vs_matchups_version_check" CHECK ("vs_matchups"."version" > 0);--> statement-breakpoint
ALTER TABLE "vs_matchups" DROP CONSTRAINT IF EXISTS "vs_matchups_identity_source_check";
--> statement-breakpoint
ALTER TABLE "vs_matchups" ADD CONSTRAINT "vs_matchups_identity_source_check" CHECK ("vs_matchups"."identity_source" in ('hq_manual', 'ashed_import'));--> statement-breakpoint
ALTER TABLE "vs_strategy_preferences" DROP CONSTRAINT IF EXISTS "vs_strategy_preferences_version_check";
--> statement-breakpoint
ALTER TABLE "vs_strategy_preferences" ADD CONSTRAINT "vs_strategy_preferences_version_check" CHECK ("vs_strategy_preferences"."version" > 0);--> statement-breakpoint
ALTER TABLE "vs_week_plans" DROP CONSTRAINT IF EXISTS "vs_week_plans_lead_days_check";
--> statement-breakpoint
ALTER TABLE "vs_week_plans" ADD CONSTRAINT "vs_week_plans_lead_days_check" CHECK ("vs_week_plans"."lead_days" between 0 and 7);--> statement-breakpoint
ALTER TABLE "vs_week_plans" DROP CONSTRAINT IF EXISTS "vs_week_plans_version_check";
--> statement-breakpoint
ALTER TABLE "vs_week_plans" ADD CONSTRAINT "vs_week_plans_version_check" CHECK ("vs_week_plans"."version" > 0);--> statement-breakpoint
ALTER TABLE "vs_week_plans" DROP CONSTRAINT IF EXISTS "vs_week_plans_week_start_monday_check";
--> statement-breakpoint
ALTER TABLE "vs_week_plans" ADD CONSTRAINT "vs_week_plans_week_start_monday_check" CHECK (extract(isodow from "vs_week_plans"."week_start"::date) = 1);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vs_match_observations_sequence_unique" ON "vs_match_observations" USING btree ("sequence");--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.check_vs_match_day_week() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_week date;
BEGIN
  SELECT week_start::date INTO parent_week FROM public.vs_matchups
    WHERE id = NEW.matchup_id AND alliance_id = NEW.alliance_id;
  IF parent_week IS NULL THEN
    RAISE EXCEPTION 'invalid_vs_matchup' USING ERRCODE = '23503';
  END IF;
  IF NEW.recorded_date IS NOT NULL AND
     (NEW.recorded_date::date < parent_week OR NEW.recorded_date::date > parent_week + 5) THEN
    RAISE EXCEPTION 'invalid_vs_match_day' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS vs_match_day_results_week_guard ON public.vs_match_day_results;
--> statement-breakpoint
CREATE TRIGGER vs_match_day_results_week_guard BEFORE INSERT OR UPDATE ON public.vs_match_day_results
FOR EACH ROW EXECUTE FUNCTION public.check_vs_match_day_week();
--> statement-breakpoint
DROP TRIGGER IF EXISTS vs_match_observations_week_guard ON public.vs_match_observations;
--> statement-breakpoint
CREATE TRIGGER vs_match_observations_week_guard BEFORE INSERT OR UPDATE ON public.vs_match_observations
FOR EACH ROW EXECUTE FUNCTION public.check_vs_match_day_week();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.check_vs_matchup_week_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.week_start IS DISTINCT FROM OLD.week_start AND (
    EXISTS (SELECT 1 FROM public.vs_match_day_results WHERE matchup_id = OLD.id AND alliance_id = OLD.alliance_id)
    OR EXISTS (SELECT 1 FROM public.vs_match_observations WHERE matchup_id = OLD.id AND alliance_id = OLD.alliance_id)
  ) THEN
    RAISE EXCEPTION 'immutable_vs_matchup_week' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS vs_matchups_week_start_guard ON public.vs_matchups;
--> statement-breakpoint
CREATE TRIGGER vs_matchups_week_start_guard BEFORE UPDATE ON public.vs_matchups
FOR EACH ROW EXECUTE FUNCTION public.check_vs_matchup_week_immutable();
