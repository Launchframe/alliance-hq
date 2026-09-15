-- Custom SQL migration file, put your code below! --
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'officer_action_items'::regclass AND conname = 'officer_action_items_id_alliance_unique') THEN
    ALTER TABLE officer_action_items ADD CONSTRAINT officer_action_items_id_alliance_unique UNIQUE (id, alliance_id);
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS knowledge_boards (
  id text PRIMARY KEY, alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  resource_id text NOT NULL UNIQUE, name text NOT NULL, version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_boards_id_alliance_unique UNIQUE (id, alliance_id),
  CONSTRAINT knowledge_boards_resource_alliance_fk FOREIGN KEY (resource_id, alliance_id) REFERENCES knowledge_resources(id, alliance_id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS knowledge_board_items (
  board_id text NOT NULL, task_id text NOT NULL, alliance_id text NOT NULL,
  grant_id text NOT NULL UNIQUE REFERENCES knowledge_resource_grants(id) ON DELETE CASCADE,
  position integer NOT NULL, shared_by_hq_user_id text REFERENCES hq_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (board_id, task_id),
  CONSTRAINT knowledge_board_items_board_alliance_fk FOREIGN KEY (board_id, alliance_id) REFERENCES knowledge_boards(id, alliance_id) ON DELETE CASCADE,
  CONSTRAINT knowledge_board_items_task_alliance_fk FOREIGN KEY (task_id, alliance_id) REFERENCES officer_action_items(id, alliance_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS knowledge_board_items_task_idx ON knowledge_board_items(task_id);
CREATE OR REPLACE FUNCTION guard_knowledge_board_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.resource_id IS DISTINCT FROM OLD.resource_id OR NEW.id IS DISTINCT FROM OLD.id OR NEW.alliance_id IS DISTINCT FROM OLD.alliance_id) THEN
    RAISE EXCEPTION 'Immutable board identity' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM knowledge_resources r WHERE r.id = NEW.resource_id AND r.alliance_id = NEW.alliance_id AND r.kind = 'board' AND r.entity_id = NEW.id) THEN
    RAISE EXCEPTION 'Invalid board identity' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'knowledge_boards'::regclass AND tgname = 'knowledge_board_identity_guard') THEN
    CREATE TRIGGER knowledge_board_identity_guard BEFORE INSERT OR UPDATE ON knowledge_boards FOR EACH ROW EXECUTE FUNCTION guard_knowledge_board_identity();
  END IF;
END $$;
INSERT INTO permissions (id, description) VALUES
  ('notes_boards:read', 'Shared officer boards'),
  ('notes_boards:write', 'Edit shared officer boards')
ON CONFLICT (id) DO UPDATE SET description = EXCLUDED.description;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, 'notes_boards:read' FROM roles r WHERE r.name IN ('owner', 'maintainer', 'officer')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, 'notes_boards:write' FROM roles r WHERE r.name IN ('owner', 'maintainer', 'officer')
ON CONFLICT DO NOTHING;
