ALTER TABLE knowledge_resources ADD COLUMN IF NOT EXISTS content_version integer NOT NULL DEFAULT 1;
ALTER TABLE knowledge_resources ADD COLUMN IF NOT EXISTS knowledge_approved_version integer;
ALTER TABLE knowledge_resources ADD COLUMN IF NOT EXISTS knowledge_approval_version integer NOT NULL DEFAULT 0;
ALTER TABLE knowledge_resources ADD COLUMN IF NOT EXISTS knowledge_consent_version integer NOT NULL DEFAULT 0;
ALTER TABLE knowledge_resources ADD COLUMN IF NOT EXISTS knowledge_approved_at timestamptz;
ALTER TABLE knowledge_resources ADD COLUMN IF NOT EXISTS knowledge_approved_by_hq_user_id text REFERENCES hq_users(id) ON DELETE SET NULL;
UPDATE knowledge_resources SET knowledge_ai_allowed = false WHERE knowledge_ai_allowed AND knowledge_consent_version = 0;

CREATE TABLE IF NOT EXISTS knowledge_index_jobs (
  id text PRIMARY KEY, alliance_id text NOT NULL, resource_id text NOT NULL, owner_hq_user_id text NOT NULL,
  content_version integer NOT NULL CHECK(content_version > 0), access_version integer NOT NULL CHECK(access_version > 0), approval_version integer NOT NULL, consent_version integer NOT NULL,
  model text NOT NULL, dimensions integer NOT NULL DEFAULT 1536 CHECK(dimensions = 1536), format_version integer NOT NULL DEFAULT 1 CHECK(format_version = 1),
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending', 'running', 'completed', 'cancelled', 'failed')),
  cursor integer NOT NULL DEFAULT 0 CHECK(cursor >= 0 AND cursor <= 4096), total_chunks integer CHECK(total_chunks > 0 AND total_chunks <= 4096), manifest_hash text,
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0 AND attempts <= 3), error_code text, lease_token text, lease_expires_at timestamptz,
  available_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_index_jobs_identity_unique UNIQUE(id, alliance_id, resource_id),
  CONSTRAINT knowledge_index_jobs_generation_unique UNIQUE(resource_id, content_version, access_version, approval_version, consent_version, model, format_version),
  CONSTRAINT knowledge_index_jobs_resource_fk FOREIGN KEY(resource_id, alliance_id) REFERENCES knowledge_resources(id, alliance_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS knowledge_index_jobs_claim_idx ON knowledge_index_jobs(state, available_at);
CREATE TABLE IF NOT EXISTS knowledge_ai_usage (
  id text PRIMARY KEY, alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE, principal_key text NOT NULL,
  operation text NOT NULL CHECK(operation IN ('index', 'query')), input_chars integer NOT NULL CHECK(input_chars > 0), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS knowledge_ai_usage_principal_idx ON knowledge_ai_usage(principal_key, created_at);

ALTER TABLE officer_intel_chunks ADD COLUMN IF NOT EXISTS resource_id text;
ALTER TABLE officer_intel_chunks ADD COLUMN IF NOT EXISTS index_job_id text;
ALTER TABLE officer_intel_chunks ADD COLUMN IF NOT EXISTS chunk_index integer;
ALTER TABLE officer_intel_chunks ADD COLUMN IF NOT EXISTS content_version integer;
ALTER TABLE officer_intel_chunks ADD COLUMN IF NOT EXISTS access_version integer;
ALTER TABLE officer_intel_chunks ADD COLUMN IF NOT EXISTS approval_version integer;
ALTER TABLE officer_intel_chunks ADD COLUMN IF NOT EXISTS consent_version integer;
ALTER TABLE officer_intel_chunks ADD COLUMN IF NOT EXISTS content_hash text;
ALTER TABLE officer_intel_chunks ADD COLUMN IF NOT EXISTS embedding_model text;
ALTER TABLE officer_intel_chunks ADD COLUMN IF NOT EXISTS embedding_dimensions integer;
ALTER TABLE officer_intel_chunks ADD COLUMN IF NOT EXISTS format_version integer;
ALTER TABLE officer_intel_chunks ADD COLUMN IF NOT EXISTS evidence jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS officer_intel_chunks_job_chunk_unique ON officer_intel_chunks(index_job_id, chunk_index);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'officer_intel_chunks_index_job_fk' AND conrelid = 'officer_intel_chunks'::regclass) THEN
    ALTER TABLE officer_intel_chunks ADD CONSTRAINT officer_intel_chunks_index_job_fk FOREIGN KEY(index_job_id, alliance_id, resource_id) REFERENCES knowledge_index_jobs(id, alliance_id, resource_id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION knowledge_consent_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.owner_hq_user_id IS DISTINCT FROM OLD.owner_hq_user_id OR NEW.ownership_state IS DISTINCT FROM OLD.ownership_state THEN
    NEW.knowledge_ai_allowed := false; NEW.knowledge_approved_version := NULL; NEW.knowledge_approved_at := NULL; NEW.knowledge_approved_by_hq_user_id := NULL;
  END IF;
  IF NEW.knowledge_ai_allowed IS DISTINCT FROM OLD.knowledge_ai_allowed OR NEW.owner_hq_user_id IS DISTINCT FROM OLD.owner_hq_user_id OR NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
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
CREATE OR REPLACE FUNCTION cancel_stale_knowledge_jobs() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE knowledge_index_jobs SET state = 'cancelled', lease_token = NULL, lease_expires_at = NULL, error_code = 'changed', updated_at = now()
  WHERE resource_id = NEW.id AND state IN ('pending', 'running') AND (
    content_version <> NEW.content_version OR access_version <> NEW.access_version OR approval_version <> NEW.knowledge_approval_version
    OR consent_version <> NEW.knowledge_consent_version OR owner_hq_user_id IS DISTINCT FROM NEW.owner_hq_user_id
    OR NOT NEW.knowledge_ai_allowed OR NEW.knowledge_approved_version IS DISTINCT FROM NEW.content_version OR NEW.archived_at IS NOT NULL);
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION touch_knowledge_content(resource_key text) RETURNS void LANGUAGE sql AS $$
  UPDATE knowledge_resources SET content_version = content_version + 1, knowledge_approved_version = NULL,
    knowledge_approved_at = NULL, knowledge_approved_by_hq_user_id = NULL WHERE id = resource_key
$$;
CREATE OR REPLACE FUNCTION track_knowledge_document_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN PERFORM touch_knowledge_content(OLD.resource_id); RETURN OLD; END IF;
  IF TG_TABLE_NAME = 'performance_notes' THEN
    IF (to_jsonb(NEW) - ARRAY['updated_at','notebook','inbox','labels','excluded_member_ids','priority','priority_mode','intake_provenance']) IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['updated_at','notebook','inbox','labels','excluded_member_ids','priority','priority_mode','intake_provenance']) THEN PERFORM touch_knowledge_content(NEW.resource_id); END IF;
  ELSIF TG_TABLE_NAME = 'officer_action_items' THEN
    IF NEW.title IS DISTINCT FROM OLD.title OR NEW.description IS DISTINCT FROM OLD.description OR NEW.status IS DISTINCT FROM OLD.status OR NEW.priority IS DISTINCT FROM OLD.priority OR NEW.due_at IS DISTINCT FROM OLD.due_at OR NEW.due_hint IS DISTINCT FROM OLD.due_hint THEN PERFORM touch_knowledge_content(NEW.resource_id); END IF;
  ELSE
    IF NEW.title IS DISTINCT FROM OLD.title OR NEW.channel_label IS DISTINCT FROM OLD.channel_label OR NEW.session_at IS DISTINCT FROM OLD.session_at OR NEW.status IS DISTINCT FROM OLD.status THEN PERFORM touch_knowledge_content(NEW.resource_id); END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION track_knowledge_message_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE resource_key text;
BEGIN
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'created_at') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'created_at') THEN RETURN NEW; END IF;
  FOR resource_key IN SELECT resource_id FROM officer_chat_sessions WHERE id IN (
    CASE WHEN TG_OP <> 'INSERT' THEN OLD.session_id END, CASE WHEN TG_OP <> 'DELETE' THEN NEW.session_id END) ORDER BY resource_id LOOP
    PERFORM touch_knowledge_content(resource_key);
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
DO $$ DECLARE table_name text; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'knowledge_consent_revision_guard' AND tgrelid = 'knowledge_resources'::regclass) THEN
    CREATE TRIGGER knowledge_consent_revision_guard BEFORE UPDATE ON knowledge_resources FOR EACH ROW EXECUTE FUNCTION knowledge_consent_revision();
    CREATE TRIGGER knowledge_cancel_stale_jobs AFTER UPDATE ON knowledge_resources FOR EACH ROW EXECUTE FUNCTION cancel_stale_knowledge_jobs();
  END IF;
  FOREACH table_name IN ARRAY ARRAY['performance_notes', 'officer_action_items', 'officer_chat_sessions'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = table_name || '_knowledge_content' AND tgrelid = table_name::regclass) THEN
      EXECUTE format('CREATE TRIGGER %I AFTER UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION track_knowledge_document_content()', table_name || '_knowledge_content', table_name);
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'officer_chat_messages_knowledge_content' AND tgrelid = 'officer_chat_messages'::regclass) THEN
    CREATE TRIGGER officer_chat_messages_knowledge_content AFTER INSERT OR UPDATE OR DELETE ON officer_chat_messages FOR EACH ROW EXECUTE FUNCTION track_knowledge_message_content();
  END IF;
END $$;
