ALTER TABLE alliances
  ADD COLUMN IF NOT EXISTS train_top_score_includes_r4_plus integer NOT NULL DEFAULT 1;
