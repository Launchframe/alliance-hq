-- Custom SQL migration file, put your code below! --
ALTER TABLE performance_notes ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT '';
ALTER TABLE performance_notes ADD COLUMN IF NOT EXISTS priority text;
ALTER TABLE performance_notes ADD COLUMN IF NOT EXISTS labels jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE performance_notes ADD COLUMN IF NOT EXISTS notebook text;
ALTER TABLE performance_notes ADD COLUMN IF NOT EXISTS journal_date text;
ALTER TABLE performance_notes ADD COLUMN IF NOT EXISTS inbox boolean NOT NULL DEFAULT true;
ALTER TABLE performance_notes ADD COLUMN IF NOT EXISTS excluded_member_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE performance_note_members ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'manual';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'performance_notes_priority_check' AND conrelid = 'performance_notes'::regclass) THEN
    ALTER TABLE performance_notes ADD CONSTRAINT performance_notes_priority_check
      CHECK (priority IS NULL OR priority IN ('low', 'medium', 'high', 'urgent'));
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS knowledge_note_revisions (
  id text PRIMARY KEY,
  note_id text NOT NULL REFERENCES performance_notes(id) ON DELETE CASCADE,
  alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  version integer NOT NULL,
  snapshot jsonb NOT NULL,
  edited_by_hq_user_id text REFERENCES hq_users(id) ON DELETE SET NULL,
  edited_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_note_revisions_version_unique UNIQUE (note_id, version)
);
INSERT INTO permissions (id, description) VALUES ('notes:read', 'Notes'), ('notes:create', 'Create notes')
ON CONFLICT (id) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, 'notes:read' FROM roles r WHERE r.name IN ('owner', 'maintainer', 'officer', 'member', 'data_entry', 'viewer')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, 'notes:create' FROM roles r WHERE r.name IN ('owner', 'maintainer', 'officer')
ON CONFLICT DO NOTHING;
