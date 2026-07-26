-- At most one extraction shadow job per upload group (early + late enqueue race).
CREATE UNIQUE INDEX IF NOT EXISTS video_jobs_one_shadow_per_group_idx
  ON video_jobs (group_id)
  WHERE pass_role = 'shadow' AND group_id IS NOT NULL;
