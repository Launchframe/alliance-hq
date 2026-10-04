-- Custom SQL migration file, put your code below! --
ALTER TABLE performance_notes ADD COLUMN IF NOT EXISTS priority_mode text NOT NULL DEFAULT 'manual';
ALTER TABLE officer_action_items ADD COLUMN IF NOT EXISTS resource_id text;
ALTER TABLE officer_action_items ADD COLUMN IF NOT EXISTS source_note_id text;
ALTER TABLE officer_action_items ADD COLUMN IF NOT EXISTS assignee_hq_user_id text REFERENCES hq_users(id) ON DELETE SET NULL;
ALTER TABLE officer_action_items ADD COLUMN IF NOT EXISTS labels jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE officer_action_items ADD COLUMN IF NOT EXISTS capture_key text;
ALTER TABLE officer_action_items ADD COLUMN IF NOT EXISTS action_key text;
ALTER TABLE officer_action_items ALTER COLUMN note_id DROP NOT NULL;
ALTER TABLE officer_action_items ALTER COLUMN session_id DROP NOT NULL;
ALTER TABLE officer_action_items ALTER COLUMN priority DROP DEFAULT;
ALTER TABLE officer_action_items ALTER COLUMN priority DROP NOT NULL;
UPDATE officer_action_items SET priority = 'medium' WHERE priority = 'normal';
ALTER TABLE officer_action_items DROP CONSTRAINT IF EXISTS officer_action_items_note_id_officer_meeting_notes_id_fk;
ALTER TABLE officer_action_items ADD CONSTRAINT officer_action_items_note_id_officer_meeting_notes_id_fk FOREIGN KEY (note_id) REFERENCES officer_meeting_notes(id) ON DELETE SET NULL;
ALTER TABLE officer_action_items DROP CONSTRAINT IF EXISTS officer_action_items_session_id_officer_chat_sessions_id_fk;
ALTER TABLE officer_action_items ADD CONSTRAINT officer_action_items_session_id_officer_chat_sessions_id_fk FOREIGN KEY (session_id) REFERENCES officer_chat_sessions(id) ON DELETE SET NULL;
INSERT INTO knowledge_resources (id, alliance_id, kind, entity_id, ownership_state, owner_hq_user_id, owner_bound_at, created_at, updated_at)
SELECT 'task:' || a.id, a.alliance_id, 'task', a.id,
  CASE WHEN coalesce(a.created_by_hq_user_id, n.synthesized_by_hq_user_id, s.created_by_hq_user_id) IS NULL THEN 'unresolved' ELSE 'hq' END,
  coalesce(a.created_by_hq_user_id, n.synthesized_by_hq_user_id, s.created_by_hq_user_id), a.created_at, a.created_at, a.updated_at
FROM officer_action_items a
LEFT JOIN officer_meeting_notes n ON n.id = a.note_id AND n.alliance_id = a.alliance_id
LEFT JOIN officer_chat_sessions s ON s.id = a.session_id AND s.alliance_id = a.alliance_id
ON CONFLICT (alliance_id, kind, entity_id) DO NOTHING;
UPDATE officer_action_items a SET resource_id = r.id FROM knowledge_resources r
WHERE a.resource_id IS NULL AND r.alliance_id = a.alliance_id AND r.kind = 'task' AND r.entity_id = a.id;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'performance_notes_id_alliance_unique' AND conrelid = 'performance_notes'::regclass) THEN
    ALTER TABLE performance_notes ADD CONSTRAINT performance_notes_id_alliance_unique UNIQUE (id, alliance_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'officer_action_items_resource_unique' AND conrelid = 'officer_action_items'::regclass) THEN
    ALTER TABLE officer_action_items ADD CONSTRAINT officer_action_items_resource_unique UNIQUE (resource_id);
    ALTER TABLE officer_action_items ADD CONSTRAINT officer_action_items_resource_alliance_fk FOREIGN KEY (resource_id, alliance_id) REFERENCES knowledge_resources(id, alliance_id) ON DELETE RESTRICT;
    ALTER TABLE officer_action_items ADD CONSTRAINT officer_action_items_source_alliance_fk FOREIGN KEY (source_note_id, alliance_id) REFERENCES performance_notes(id, alliance_id) ON DELETE RESTRICT;
    ALTER TABLE officer_action_items ADD CONSTRAINT officer_action_items_capture_unique UNIQUE (capture_key, action_key);
    ALTER TABLE officer_action_items ADD CONSTRAINT officer_action_items_priority_check CHECK (priority IS NULL OR priority IN ('low', 'medium', 'high', 'urgent'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS officer_action_items_source_idx ON officer_action_items(source_note_id);
CREATE OR REPLACE FUNCTION bind_officer_task_resource() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id text;
BEGIN
  IF NEW.priority = 'normal' THEN NEW.priority := 'medium'; END IF;
  IF TG_OP = 'UPDATE' AND OLD.resource_id IS NOT NULL AND NEW.resource_id IS DISTINCT FROM OLD.resource_id THEN
    RAISE EXCEPTION 'Task resource identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.resource_id IS NULL THEN
    SELECT coalesce(NEW.created_by_hq_user_id, n.synthesized_by_hq_user_id, s.created_by_hq_user_id) INTO owner_id
    FROM (SELECT 1) seed
    LEFT JOIN officer_meeting_notes n ON n.id = NEW.note_id AND n.alliance_id = NEW.alliance_id
    LEFT JOIN officer_chat_sessions s ON s.id = NEW.session_id AND s.alliance_id = NEW.alliance_id;
    NEW.resource_id := 'task:' || NEW.id;
    INSERT INTO knowledge_resources (id, alliance_id, kind, entity_id, ownership_state, owner_hq_user_id, owner_bound_at)
    VALUES (NEW.resource_id, NEW.alliance_id, 'task', NEW.id, CASE WHEN owner_id IS NULL THEN 'unresolved' ELSE 'hq' END, owner_id, CASE WHEN owner_id IS NULL THEN NULL ELSE now() END);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM knowledge_resources r WHERE r.id = NEW.resource_id AND r.alliance_id = NEW.alliance_id AND r.kind = 'task' AND r.entity_id = NEW.id) THEN
    RAISE EXCEPTION 'Invalid task resource identity' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'officer_action_items_resource_guard' AND tgrelid = 'officer_action_items'::regclass) THEN
    CREATE TRIGGER officer_action_items_resource_guard BEFORE INSERT OR UPDATE OF priority, resource_id ON officer_action_items FOR EACH ROW EXECUTE FUNCTION bind_officer_task_resource();
  END IF;
END $$;
ALTER TABLE officer_action_items ALTER COLUMN resource_id SET NOT NULL;
ALTER TABLE officer_action_items ALTER COLUMN resource_id SET DEFAULT NULL;
CREATE TABLE IF NOT EXISTS knowledge_mutation_receipts (
  id text PRIMARY KEY, alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  principal_key text NOT NULL, request_id text NOT NULL, request_hash text NOT NULL, result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_mutation_receipts_request_unique UNIQUE (alliance_id, principal_key, request_id)
);
CREATE TABLE IF NOT EXISTS knowledge_intake_preferences (
  principal_key text PRIMARY KEY, enabled boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS knowledge_intake_analyses (
  id text PRIMARY KEY, alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  principal_key text NOT NULL, request_hash text NOT NULL, state text NOT NULL, result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS knowledge_intake_analyses_rate_idx ON knowledge_intake_analyses(principal_key, created_at);
