ALTER TABLE alliances
  ADD COLUMN IF NOT EXISTS train_top_score_min_rank integer NOT NULL DEFAULT 3;
