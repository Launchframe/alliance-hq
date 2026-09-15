ALTER TABLE performance_notes ADD COLUMN IF NOT EXISTS document_type text NOT NULL DEFAULT 'note';
ALTER TABLE performance_notes ADD COLUMN IF NOT EXISTS key_decisions jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE performance_notes ADD COLUMN IF NOT EXISTS open_questions jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE officer_meeting_notes ADD COLUMN IF NOT EXISTS canonical_note_id text;
CREATE UNIQUE INDEX IF NOT EXISTS performance_notes_identity_unique ON performance_notes(id, alliance_id, resource_id);

INSERT INTO performance_notes (id, alliance_id, resource_id, title, body, document_type, key_decisions, open_questions, kind, intake_mode, source, created_by_hq_user_id, inbox, created_at, updated_at)
SELECT 'meeting:' || n.id, n.alliance_id, n.resource_id, left(split_part(n.summary, E'\n', 1), 160), n.summary,
  'meeting', n.key_decisions, n.open_questions, 'note', 'thought', 'web', n.synthesized_by_hq_user_id, false, n.created_at, n.updated_at
FROM officer_meeting_notes n WHERE n.canonical_note_id IS NULL
ON CONFLICT (id) DO NOTHING;
UPDATE officer_meeting_notes SET canonical_note_id = 'meeting:' || id WHERE canonical_note_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS officer_meeting_notes_canonical_unique ON officer_meeting_notes(canonical_note_id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'officer_meeting_notes_canonical_fk' AND conrelid = 'officer_meeting_notes'::regclass) THEN
    ALTER TABLE officer_meeting_notes ADD CONSTRAINT officer_meeting_notes_canonical_fk FOREIGN KEY(canonical_note_id, alliance_id, resource_id) REFERENCES performance_notes(id, alliance_id, resource_id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'performance_notes_document_type_check' AND conrelid = 'performance_notes'::regclass) THEN
    ALTER TABLE performance_notes ADD CONSTRAINT performance_notes_document_type_check CHECK(document_type IN ('note', 'journal', 'meeting', 'reference'));
  END IF;
END $$;
ALTER TABLE officer_meeting_notes ALTER COLUMN canonical_note_id SET NOT NULL;

CREATE OR REPLACE FUNCTION bind_canonical_meeting_note() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.canonical_note_id IS DISTINCT FROM OLD.canonical_note_id OR NEW.summary IS DISTINCT FROM OLD.summary
      OR NEW.key_decisions IS DISTINCT FROM OLD.key_decisions OR NEW.open_questions IS DISTINCT FROM OLD.open_questions THEN
      RAISE EXCEPTION 'Legacy meeting text and canonical identity are immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.canonical_note_id IS NOT NULL AND NEW.canonical_note_id <> 'meeting:' || NEW.id THEN
    RAISE EXCEPTION 'Invalid canonical meeting identity' USING ERRCODE = '23514';
  END IF;
  NEW.canonical_note_id := 'meeting:' || NEW.id;
  INSERT INTO performance_notes (id, alliance_id, resource_id, title, body, document_type, key_decisions, open_questions, kind, intake_mode, source, created_by_hq_user_id, inbox, created_at, updated_at)
  VALUES (NEW.canonical_note_id, NEW.alliance_id, NEW.resource_id, left(split_part(NEW.summary, E'\n', 1), 160), NEW.summary,
    'meeting', NEW.key_decisions, NEW.open_questions, 'note', 'thought', 'web', NEW.synthesized_by_hq_user_id, false, NEW.created_at, NEW.updated_at);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION invalidate_meeting_approval() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.title IS DISTINCT FROM OLD.title OR NEW.body IS DISTINCT FROM OLD.body OR NEW.document_type IS DISTINCT FROM OLD.document_type
    OR NEW.key_decisions IS DISTINCT FROM OLD.key_decisions OR NEW.open_questions IS DISTINCT FROM OLD.open_questions THEN
    UPDATE officer_meeting_notes SET status = 'draft', approved_at = NULL, approved_by_hq_user_id = NULL, updated_at = NEW.updated_at
    WHERE canonical_note_id = NEW.id AND alliance_id = NEW.alliance_id;
  END IF;
  RETURN NEW;
END $$;

UPDATE officer_action_items a SET source_note_id = n.canonical_note_id FROM officer_meeting_notes n
WHERE a.note_id = n.id AND a.alliance_id = n.alliance_id AND a.source_note_id IS NULL;
CREATE OR REPLACE FUNCTION bind_task_canonical_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source_note_id IS NULL AND NEW.note_id IS NOT NULL THEN
    SELECT canonical_note_id INTO NEW.source_note_id FROM officer_meeting_notes WHERE id = NEW.note_id AND alliance_id = NEW.alliance_id;
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'zz_meeting_canonical_guard' AND tgrelid = 'officer_meeting_notes'::regclass) THEN
    CREATE TRIGGER zz_meeting_canonical_guard BEFORE INSERT OR UPDATE ON officer_meeting_notes FOR EACH ROW EXECUTE FUNCTION bind_canonical_meeting_note();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'performance_notes_approval_guard' AND tgrelid = 'performance_notes'::regclass) THEN
    CREATE TRIGGER performance_notes_approval_guard AFTER UPDATE OF title, body, document_type, key_decisions, open_questions ON performance_notes FOR EACH ROW EXECUTE FUNCTION invalidate_meeting_approval();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'zz_task_canonical_source' AND tgrelid = 'officer_action_items'::regclass) THEN
    CREATE TRIGGER zz_task_canonical_source BEFORE INSERT ON officer_action_items FOR EACH ROW EXECUTE FUNCTION bind_task_canonical_source();
  END IF;
END $$;
