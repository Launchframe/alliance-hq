-- Custom SQL migration file, put your code below! --
ALTER TABLE knowledge_resources DROP CONSTRAINT IF EXISTS knowledge_resources_kind_check;
ALTER TABLE knowledge_resources ADD CONSTRAINT knowledge_resources_kind_check CHECK (kind IN ('note', 'task', 'source', 'collection', 'board', 'draft'));
ALTER TABLE performance_notes ADD COLUMN IF NOT EXISTS intake_provenance jsonb;
ALTER TABLE officer_action_items ADD COLUMN IF NOT EXISTS intake_provenance jsonb;
CREATE TABLE IF NOT EXISTS knowledge_capture_drafts (
  id text PRIMARY KEY, alliance_id text NOT NULL, resource_id text NOT NULL UNIQUE,
  source text NOT NULL CHECK (source IN ('web', 'discord')), source_note_id text, source_version integer,
  state jsonb, state_hash text NOT NULL, status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'committed')),
  note_id text REFERENCES performance_notes(id) ON DELETE RESTRICT, task_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_capture_drafts_resource_alliance_fk FOREIGN KEY (resource_id, alliance_id) REFERENCES knowledge_resources(id, alliance_id) ON DELETE RESTRICT,
  CONSTRAINT knowledge_capture_drafts_source_alliance_fk FOREIGN KEY (source_note_id, alliance_id) REFERENCES performance_notes(id, alliance_id) ON DELETE RESTRICT,
  CONSTRAINT knowledge_capture_drafts_note_alliance_fk FOREIGN KEY (note_id, alliance_id) REFERENCES performance_notes(id, alliance_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS knowledge_capture_drafts_alliance_updated_idx ON knowledge_capture_drafts(alliance_id, updated_at);
CREATE OR REPLACE FUNCTION guard_capture_draft_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.alliance_id IS DISTINCT FROM OLD.alliance_id OR NEW.resource_id IS DISTINCT FROM OLD.resource_id OR NEW.source IS DISTINCT FROM OLD.source OR NEW.source_note_id IS DISTINCT FROM OLD.source_note_id) THEN
    RAISE EXCEPTION 'Immutable draft identity' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'committed' AND NEW.status <> 'committed' THEN
    RAISE EXCEPTION 'Committed draft cannot reopen' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM knowledge_resources r WHERE r.id = NEW.resource_id AND r.alliance_id = NEW.alliance_id AND r.kind = 'draft' AND r.entity_id = NEW.id) THEN
    RAISE EXCEPTION 'Invalid draft identity' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'knowledge_capture_drafts'::regclass AND tgname = 'knowledge_capture_drafts_identity_guard') THEN
    CREATE TRIGGER knowledge_capture_drafts_identity_guard BEFORE INSERT OR UPDATE ON knowledge_capture_drafts FOR EACH ROW EXECUTE FUNCTION guard_capture_draft_identity();
  END IF;
END $$;
