CREATE TABLE IF NOT EXISTS vs_score_manual_edits (
  id text PRIMARY KEY,
  alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  actor_id text NOT NULL,
  member_id text NOT NULL,
  week_ending text NOT NULL,
  request_id text NOT NULL,
  request_digest text NOT NULL,
  reason text,
  result_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vs_score_manual_edits_request_unique UNIQUE (alliance_id, actor_id, request_id),
  CONSTRAINT vs_score_manual_edits_reason_length CHECK (reason IS NULL OR char_length(reason) <= 2000)
);
CREATE INDEX IF NOT EXISTS vs_score_manual_edits_member_week_idx ON vs_score_manual_edits (alliance_id, member_id, week_ending, recorded_at DESC);

CREATE TABLE IF NOT EXISTS vs_score_manual_edit_batches (
  batch_id text PRIMARY KEY REFERENCES data_upload_batches(id) ON DELETE CASCADE,
  edit_id text NOT NULL REFERENCES vs_score_manual_edits(id) ON DELETE CASCADE,
  recorded_date text NOT NULL,
  period text NOT NULL CHECK (period IN ('daily', 'weekly'))
);
CREATE INDEX IF NOT EXISTS vs_score_manual_edit_batches_edit_idx ON vs_score_manual_edit_batches (edit_id);
