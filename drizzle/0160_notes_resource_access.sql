-- Custom SQL migration file, put your code below! --
CREATE TABLE IF NOT EXISTS knowledge_resources (
  id text PRIMARY KEY,
  alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('note', 'task', 'source', 'collection', 'board')),
  entity_id text NOT NULL,
  ownership_state text NOT NULL DEFAULT 'unresolved' CONSTRAINT knowledge_resources_ownership_check CHECK (ownership_state IN ('hq', 'discord', 'unresolved')),
  owner_hq_user_id text REFERENCES hq_users(id) ON DELETE SET NULL,
  owner_discord_user_id text,
  owner_bound_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  access_version integer NOT NULL DEFAULT 1,
  intake_ai_allowed boolean NOT NULL DEFAULT false,
  knowledge_ai_allowed boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_resources_id_alliance_unique UNIQUE (id, alliance_id),
  CONSTRAINT knowledge_resources_entity_unique UNIQUE (alliance_id, kind, entity_id),
  CONSTRAINT knowledge_resources_version_check CHECK (version > 0 AND access_version > 0)
);
CREATE INDEX IF NOT EXISTS knowledge_resources_owner_idx ON knowledge_resources (alliance_id, owner_hq_user_id);
CREATE INDEX IF NOT EXISTS knowledge_resources_discord_owner_idx ON knowledge_resources (owner_discord_user_id, ownership_state);

CREATE TABLE IF NOT EXISTS knowledge_resource_grants (
  id text PRIMARY KEY,
  resource_id text NOT NULL,
  alliance_id text NOT NULL,
  subject_kind text NOT NULL CONSTRAINT knowledge_resource_grants_subject_check CHECK (subject_kind IN ('user', 'officers', 'board')),
  subject_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('read', 'edit')),
  created_by_hq_user_id text REFERENCES hq_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_resource_grants_resource_alliance_fk FOREIGN KEY (resource_id, alliance_id) REFERENCES knowledge_resources(id, alliance_id) ON DELETE CASCADE,
  CONSTRAINT knowledge_resource_grants_subject_unique UNIQUE (resource_id, subject_kind, subject_id)
);
CREATE INDEX IF NOT EXISTS knowledge_resource_grants_subject_idx ON knowledge_resource_grants (alliance_id, subject_kind, subject_id);

ALTER TABLE performance_notes ADD COLUMN IF NOT EXISTS resource_id text;
INSERT INTO knowledge_resources (
  id, alliance_id, kind, entity_id, ownership_state, owner_hq_user_id,
  owner_discord_user_id, owner_bound_at, created_at, updated_at
)
SELECT 'note:' || n.id, n.alliance_id, 'note', n.id,
  CASE WHEN n.created_by_hq_user_id IS NOT NULL THEN 'hq'
       WHEN n.created_by_discord_user_id IS NOT NULL THEN 'discord'
       ELSE 'unresolved' END,
  n.created_by_hq_user_id, n.created_by_discord_user_id,
  CASE WHEN n.created_by_hq_user_id IS NOT NULL THEN n.created_at ELSE NULL END,
  n.created_at, n.updated_at
FROM performance_notes n
ON CONFLICT (alliance_id, kind, entity_id) DO NOTHING;
UPDATE performance_notes n SET resource_id = r.id
FROM knowledge_resources r
WHERE n.resource_id IS NULL AND r.alliance_id = n.alliance_id AND r.kind = 'note' AND r.entity_id = n.id;
CREATE UNIQUE INDEX IF NOT EXISTS performance_notes_resource_unique ON performance_notes (resource_id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'performance_notes_resource_alliance_fk' AND conrelid = 'performance_notes'::regclass) THEN
    ALTER TABLE performance_notes ADD CONSTRAINT performance_notes_resource_alliance_fk
      FOREIGN KEY (resource_id, alliance_id) REFERENCES knowledge_resources(id, alliance_id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION bind_performance_note_resource() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.source IS DISTINCT FROM OLD.source OR (OLD.resource_id IS NOT NULL AND NEW.resource_id IS DISTINCT FROM OLD.resource_id)) THEN
    RAISE EXCEPTION 'Note source and resource identity are immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.resource_id IS NULL THEN
    NEW.resource_id := 'note:' || NEW.id;
    INSERT INTO knowledge_resources (id, alliance_id, kind, entity_id, ownership_state, owner_hq_user_id, owner_discord_user_id, owner_bound_at, created_at, updated_at)
    VALUES (NEW.resource_id, NEW.alliance_id, 'note', NEW.id,
      CASE WHEN NEW.created_by_hq_user_id IS NOT NULL THEN 'hq' WHEN NEW.created_by_discord_user_id IS NOT NULL THEN 'discord' ELSE 'unresolved' END,
      NEW.created_by_hq_user_id, NEW.created_by_discord_user_id,
      CASE WHEN NEW.created_by_hq_user_id IS NOT NULL THEN NEW.created_at ELSE NULL END,
      NEW.created_at, NEW.updated_at);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM knowledge_resources r WHERE r.id = NEW.resource_id AND r.alliance_id = NEW.alliance_id AND r.kind = 'note' AND r.entity_id = NEW.id) THEN
    RAISE EXCEPTION 'Invalid note resource identity' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'performance_notes_resource_guard' AND tgrelid = 'performance_notes'::regclass) THEN
    CREATE TRIGGER performance_notes_resource_guard BEFORE INSERT OR UPDATE OF source, resource_id ON performance_notes
      FOR EACH ROW EXECUTE FUNCTION bind_performance_note_resource();
  END IF;
END $$;
ALTER TABLE performance_notes ALTER COLUMN resource_id SET NOT NULL;
