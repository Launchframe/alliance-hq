ALTER TABLE "alliances"
  ADD COLUMN IF NOT EXISTS "train_channel_setter_min_rank" text
  DEFAULT 'officer' NOT NULL;
