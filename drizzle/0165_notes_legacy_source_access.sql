ALTER TABLE officer_chat_sessions ADD COLUMN IF NOT EXISTS resource_id text;
ALTER TABLE officer_meeting_notes ADD COLUMN IF NOT EXISTS resource_id text;

INSERT INTO knowledge_resources (id, alliance_id, kind, entity_id, ownership_state, owner_hq_user_id, owner_bound_at, created_at, updated_at)
SELECT 'source:' || id, alliance_id, 'source', id, CASE WHEN created_by_hq_user_id IS NULL THEN 'unresolved' ELSE 'hq' END,
  created_by_hq_user_id, CASE WHEN created_by_hq_user_id IS NOT NULL THEN created_at END, created_at, updated_at
FROM officer_chat_sessions ON CONFLICT (alliance_id, kind, entity_id) DO NOTHING;
UPDATE officer_chat_sessions s SET resource_id = r.id FROM knowledge_resources r
WHERE s.resource_id IS NULL AND r.alliance_id = s.alliance_id AND r.kind = 'source' AND r.entity_id = s.id;

INSERT INTO knowledge_resources (id, alliance_id, kind, entity_id, ownership_state, owner_hq_user_id, owner_bound_at, created_at, updated_at)
SELECT 'meeting:' || id, alliance_id, 'note', 'meeting:' || id, CASE WHEN synthesized_by_hq_user_id IS NULL THEN 'unresolved' ELSE 'hq' END,
  synthesized_by_hq_user_id, CASE WHEN synthesized_by_hq_user_id IS NOT NULL THEN created_at END, created_at, updated_at
FROM officer_meeting_notes ON CONFLICT (alliance_id, kind, entity_id) DO NOTHING;
UPDATE officer_meeting_notes n SET resource_id = r.id FROM knowledge_resources r
WHERE n.resource_id IS NULL AND r.alliance_id = n.alliance_id AND r.kind = 'note' AND r.entity_id = 'meeting:' || n.id;

CREATE OR REPLACE FUNCTION bind_officer_intel_resource() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE resource_kind text; resource_entity text; resource_prefix text; owner_id text;
BEGIN
  IF TG_TABLE_NAME = 'officer_chat_sessions' THEN
    resource_kind := 'source'; resource_entity := NEW.id; resource_prefix := 'source:';
    owner_id := to_jsonb(NEW)->>'created_by_hq_user_id';
  ELSE
    resource_kind := 'note'; resource_entity := 'meeting:' || NEW.id; resource_prefix := 'meeting:';
    owner_id := to_jsonb(NEW)->>'synthesized_by_hq_user_id';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.alliance_id IS DISTINCT FROM OLD.alliance_id OR NEW.resource_id IS DISTINCT FROM OLD.resource_id) THEN
    RAISE EXCEPTION 'Source resource identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.resource_id IS NULL THEN
    NEW.resource_id := resource_prefix || NEW.id;
    INSERT INTO knowledge_resources (id, alliance_id, kind, entity_id, ownership_state, owner_hq_user_id, owner_bound_at, created_at, updated_at)
    VALUES (NEW.resource_id, NEW.alliance_id, resource_kind, resource_entity, CASE WHEN owner_id IS NULL THEN 'unresolved' ELSE 'hq' END,
      owner_id, CASE WHEN owner_id IS NOT NULL THEN NEW.created_at END, NEW.created_at, NEW.updated_at);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM knowledge_resources r WHERE r.id = NEW.resource_id AND r.alliance_id = NEW.alliance_id AND r.kind = resource_kind AND r.entity_id = resource_entity) THEN
    RAISE EXCEPTION 'Invalid source resource identity' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['officer_chat_sessions', 'officer_meeting_notes'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = table_name || '_resource_alliance_fk' AND conrelid = table_name::regclass) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (resource_id, alliance_id) REFERENCES knowledge_resources(id, alliance_id) ON DELETE RESTRICT', table_name, table_name || '_resource_alliance_fk');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = table_name || '_resource_guard' AND tgrelid = table_name::regclass) THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF id, alliance_id, resource_id ON %I FOR EACH ROW EXECUTE FUNCTION bind_officer_intel_resource()', table_name || '_resource_guard', table_name);
    END IF;
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I (resource_id)', table_name || '_resource_unique', table_name);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN resource_id SET NOT NULL', table_name);
  END LOOP;
END $$;
