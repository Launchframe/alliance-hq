-- A verified HQ account merge is the owner's consent: resources moving from the merged-away
-- user to the canonical user keep their AI consent, approval, and consent version. The merge
-- transaction sets the transaction-local `alliance_hq.knowledge_merge_owner` to
-- '<source>><canonical>'; every other owner or ownership-state change still resets consent.
CREATE OR REPLACE FUNCTION knowledge_consent_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE merge_carry boolean;
BEGIN
  merge_carry := coalesce(NEW.owner_hq_user_id IS DISTINCT FROM OLD.owner_hq_user_id
    AND OLD.owner_hq_user_id IS NOT NULL AND NEW.owner_hq_user_id IS NOT NULL
    AND NEW.ownership_state IS NOT DISTINCT FROM OLD.ownership_state AND NEW.ownership_state = 'hq'
    AND NEW.knowledge_ai_allowed IS NOT DISTINCT FROM OLD.knowledge_ai_allowed
    AND NEW.archived_at IS NOT DISTINCT FROM OLD.archived_at
    AND current_setting('alliance_hq.knowledge_merge_owner', true) = OLD.owner_hq_user_id || '>' || NEW.owner_hq_user_id, false);
  IF NOT merge_carry AND (NEW.owner_hq_user_id IS DISTINCT FROM OLD.owner_hq_user_id OR NEW.ownership_state IS DISTINCT FROM OLD.ownership_state) THEN
    NEW.knowledge_ai_allowed := false; NEW.knowledge_approved_version := NULL; NEW.knowledge_approved_at := NULL; NEW.knowledge_approved_by_hq_user_id := NULL;
  END IF;
  IF NEW.knowledge_ai_allowed IS DISTINCT FROM OLD.knowledge_ai_allowed OR (NOT merge_carry AND NEW.owner_hq_user_id IS DISTINCT FROM OLD.owner_hq_user_id) OR NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    NEW.knowledge_consent_version := OLD.knowledge_consent_version + 1;
  END IF;
  IF NEW.knowledge_approved_version IS DISTINCT FROM OLD.knowledge_approved_version THEN
    NEW.knowledge_approval_version := OLD.knowledge_approval_version + 1;
  END IF;
  IF NEW.knowledge_approved_version IS NOT NULL AND NEW.knowledge_approved_version <> NEW.content_version THEN
    RAISE EXCEPTION 'Approval must match current content' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
