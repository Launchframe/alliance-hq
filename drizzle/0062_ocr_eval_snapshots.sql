-- OCR eval snapshots for long-lived tandem Ashed vs native reporting
CREATE TABLE IF NOT EXISTS ocr_eval_snapshots (
  id text PRIMARY KEY,
  group_id text NOT NULL,
  primary_job_id text NOT NULL,
  shadow_job_id text NOT NULL,
  score_target text,
  board_key text,
  hq_event_id text,
  primary_engine text NOT NULL,
  shadow_engine text NOT NULL,
  native_pass_key text,
  experiment_campaign_id text,
  experiment_arm_id text,
  metrics_json jsonb NOT NULL,
  shadow_total_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ocr_eval_snapshots_score_target_created_at_idx
  ON ocr_eval_snapshots (score_target, created_at);

CREATE INDEX IF NOT EXISTS ocr_eval_snapshots_native_pass_key_created_at_idx
  ON ocr_eval_snapshots (native_pass_key, created_at);

CREATE INDEX IF NOT EXISTS ocr_eval_snapshots_experiment_campaign_arm_idx
  ON ocr_eval_snapshots (experiment_campaign_id, experiment_arm_id);
