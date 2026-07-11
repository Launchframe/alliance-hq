-- One active WL assignment per Engineer per alliance
CREATE UNIQUE INDEX IF NOT EXISTS "wl_eng_assignments_one_active_per_eng"
  ON "wl_eng_assignments" ("alliance_id", "eng_commander_id")
  WHERE "status" = 'active';
