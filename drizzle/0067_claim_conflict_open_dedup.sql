DELETE FROM "hq_claim_conflicts" newer
USING "hq_claim_conflicts" older
WHERE newer."status" = 'open'
  AND older."status" = 'open'
  AND newer."alliance_id" = older."alliance_id"
  AND newer."ashed_member_id" = older."ashed_member_id"
  AND newer."reason" = older."reason"
  AND (
    (
      newer."hq_user_id" IS NOT NULL
      AND newer."hq_user_id" = older."hq_user_id"
    )
    OR (
      newer."hq_user_id" IS NULL
      AND older."hq_user_id" IS NULL
      AND newer."handle" = older."handle"
    )
  )
  AND (
    newer."created_at" > older."created_at"
    OR (
      newer."created_at" = older."created_at"
      AND newer."id" > older."id"
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS "hq_claim_conflicts_open_hq_user_unique"
  ON "hq_claim_conflicts" ("alliance_id", "ashed_member_id", "reason", "hq_user_id")
  WHERE "status" = 'open' AND "hq_user_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "hq_claim_conflicts_open_handle_unique"
  ON "hq_claim_conflicts" ("alliance_id", "ashed_member_id", "reason", "handle")
  WHERE "status" = 'open' AND "hq_user_id" IS NULL;
