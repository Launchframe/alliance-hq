-- Extend claim-conflict open-row dedup to cross_layer_claim help requests.
DROP INDEX IF EXISTS "hq_member_link_help_open_claim_hq_user_unique";
DROP INDEX IF EXISTS "hq_member_link_help_open_claim_handle_unique";

CREATE UNIQUE INDEX IF NOT EXISTS "hq_member_link_help_open_claim_hq_user_unique"
  ON "hq_member_link_help_requests" (
    "alliance_id",
    "linked_ashed_member_id",
    "claim_conflict_reason",
    "hq_user_id"
  )
  WHERE "status" = 'open'
    AND "context" IN ('claim_conflict', 'cross_layer_claim')
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
    AND "context" IN ('claim_conflict', 'cross_layer_claim')
    AND "hq_user_id" IS NULL
    AND "linked_ashed_member_id" IS NOT NULL
    AND "claim_conflict_reason" IS NOT NULL;
