CREATE TABLE IF NOT EXISTS knowledge_publications (
  id text PRIMARY KEY, alliance_id text NOT NULL, note_id text NOT NULL, resource_id text NOT NULL, owner_hq_user_id text NOT NULL,
  source_version integer NOT NULL, snapshot_version integer NOT NULL, version integer NOT NULL DEFAULT 1,
  title text NOT NULL, body text NOT NULL, locale text NOT NULL CHECK(locale IN ('en-US','pt-BR')),
  state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published','revoked')),
  token_hash text, token_cipher text, expires_at timestamptz NOT NULL, published_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_publications_snapshot_unique UNIQUE(resource_id, snapshot_version),
  CONSTRAINT knowledge_publications_note_fk FOREIGN KEY(note_id, alliance_id, resource_id) REFERENCES performance_notes(id, alliance_id, resource_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_publications_token_unique ON knowledge_publications(token_hash);
CREATE OR REPLACE FUNCTION preserve_publication_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.note_id IS DISTINCT FROM OLD.note_id OR NEW.resource_id IS DISTINCT FROM OLD.resource_id OR NEW.alliance_id IS DISTINCT FROM OLD.alliance_id
    OR NEW.owner_hq_user_id IS DISTINCT FROM OLD.owner_hq_user_id OR NEW.source_version IS DISTINCT FROM OLD.source_version OR NEW.snapshot_version IS DISTINCT FROM OLD.snapshot_version
    OR NEW.title IS DISTINCT FROM OLD.title OR NEW.body IS DISTINCT FROM OLD.body OR NEW.locale IS DISTINCT FROM OLD.locale OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'Publication snapshots are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'knowledge_publication_snapshot_guard' AND tgrelid = 'knowledge_publications'::regclass) THEN
    CREATE TRIGGER knowledge_publication_snapshot_guard BEFORE UPDATE ON knowledge_publications FOR EACH ROW EXECUTE FUNCTION preserve_publication_snapshot();
  END IF;
END $$;
