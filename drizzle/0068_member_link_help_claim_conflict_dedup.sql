ALTER TABLE hq_member_link_help_requests
  ADD COLUMN IF NOT EXISTS claim_conflict_reason text;

DELETE FROM hq_member_link_help_requests newer
USING hq_member_link_help_requests older
WHERE newer.status = 'open'
  AND older.status = 'open'
  AND newer.context = 'claim_conflict'
  AND older.context = 'claim_conflict'
  AND newer.alliance_id = older.alliance_id
  AND newer.linked_ashed_member_id IS NOT NULL
  AND older.linked_ashed_member_id IS NOT NULL
  AND newer.linked_ashed_member_id = older.linked_ashed_member_id
  AND newer.claim_conflict_reason IS NOT NULL
  AND older.claim_conflict_reason IS NOT NULL
  AND newer.claim_conflict_reason = older.claim_conflict_reason
  AND (
    (
      newer.hq_user_id IS NOT NULL
      AND newer.hq_user_id = older.hq_user_id
    )
    OR (
      newer.hq_user_id IS NULL
      AND older.hq_user_id IS NULL
      AND newer.requester_handle = older.requester_handle
    )
  )
  AND (
    newer.created_at > older.created_at
    OR (
      newer.created_at = older.created_at
      AND newer.id > older.id
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS "hq_member_link_help_open_claim_hq_user_unique"
  ON "hq_member_link_help_requests" (
    "alliance_id",
    "linked_ashed_member_id",
    "claim_conflict_reason",
    "hq_user_id"
  )
  WHERE "status" = 'open'
    AND "context" = 'claim_conflict'
    AND "hq_user_id" IS NOT NULL
    AND "linked_ashed_member_id" IS NOT NULL
    AND "claim_conflict_reason" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "hq_member_link_help_open_claim_handle_unique"
  ON "hq_member_link_help_requests" (
    "alliance_id",
    "linked_ashed_member_id",
    "claim_conflict_reason",
    "requester_handle"
  )
  WHERE "status" = 'open'
    AND "context" = 'claim_conflict'
    AND "hq_user_id" IS NULL
    AND "linked_ashed_member_id" IS NOT NULL
    AND "claim_conflict_reason" IS NOT NULL;
