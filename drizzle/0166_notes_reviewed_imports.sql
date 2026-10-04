ALTER TABLE officer_chat_messages ALTER COLUMN sender_name DROP NOT NULL;
ALTER TABLE officer_chat_messages ALTER COLUMN source_image_index DROP NOT NULL;
ALTER TABLE officer_chat_messages ADD COLUMN IF NOT EXISTS source_locator text;
ALTER TABLE officer_chat_messages ADD COLUMN IF NOT EXISTS external_message_id text;
ALTER TABLE officer_chat_messages ADD COLUMN IF NOT EXISTS sent_at timestamptz;
ALTER TABLE officer_chat_messages ADD COLUMN IF NOT EXISTS history_included boolean NOT NULL DEFAULT true;
ALTER TABLE officer_chat_messages ADD COLUMN IF NOT EXISTS history_reviewed boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS officer_chat_messages_source_locator_unique ON officer_chat_messages(session_id, source_locator);
CREATE UNIQUE INDEX IF NOT EXISTS officer_chat_sessions_source_identity_unique ON officer_chat_sessions(id, alliance_id, resource_id);

CREATE TABLE IF NOT EXISTS knowledge_history_imports (
  id text PRIMARY KEY REFERENCES officer_chat_sessions(id) ON DELETE RESTRICT,
  alliance_id text NOT NULL, resource_id text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('text', 'markdown', 'discord_json', 'screenshots')),
  state text NOT NULL DEFAULT 'uploading' CHECK (state IN ('uploading', 'queued', 'processing', 'review', 'committed', 'cancelled', 'failed')),
  source_hash text NOT NULL, format_version integer NOT NULL DEFAULT 1 CHECK (format_version = 1), locale text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_history_imports_id_alliance_unique UNIQUE(id, alliance_id),
  CONSTRAINT knowledge_history_imports_resource_fk FOREIGN KEY(resource_id, alliance_id) REFERENCES knowledge_resources(id, alliance_id) ON DELETE RESTRICT,
  CONSTRAINT knowledge_history_imports_source_fk FOREIGN KEY(id, alliance_id, resource_id) REFERENCES officer_chat_sessions(id, alliance_id, resource_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS knowledge_history_imports_hash_idx ON knowledge_history_imports(alliance_id, source_hash);

CREATE TABLE IF NOT EXISTS knowledge_history_assets (
  id text PRIMARY KEY, import_id text NOT NULL, alliance_id text NOT NULL,
  name text NOT NULL, content_type text NOT NULL, size integer NOT NULL CHECK(size > 0 AND size <= 20971520), sha256 text NOT NULL,
  position integer NOT NULL CHECK(position >= 0 AND position < 12), staging_key text NOT NULL, sealed_key text, sealed_at timestamptz,
  CONSTRAINT knowledge_history_assets_position_unique UNIQUE(import_id, position),
  CONSTRAINT knowledge_history_assets_import_fk FOREIGN KEY(import_id, alliance_id) REFERENCES knowledge_history_imports(id, alliance_id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS knowledge_processing_jobs (
  id text PRIMARY KEY, import_id text NOT NULL UNIQUE, alliance_id text NOT NULL, owner_hq_user_id text NOT NULL,
  source_version integer NOT NULL CHECK(source_version > 0), access_version integer NOT NULL CHECK(access_version > 0),
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending', 'running', 'completed', 'cancelled', 'failed')),
  cursor integer NOT NULL DEFAULT 0 CHECK(cursor >= 0 AND cursor <= 12), attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0 AND attempts <= 3), error_code text,
  lease_token text, lease_expires_at timestamptz, available_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_processing_jobs_import_fk FOREIGN KEY(import_id, alliance_id) REFERENCES knowledge_history_imports(id, alliance_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS knowledge_processing_jobs_claim_idx ON knowledge_processing_jobs(state, available_at);

CREATE OR REPLACE FUNCTION guard_sealed_history_asset() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.import_id IS DISTINCT FROM OLD.import_id OR NEW.alliance_id IS DISTINCT FROM OLD.alliance_id
    OR NEW.position IS DISTINCT FROM OLD.position OR NEW.staging_key IS DISTINCT FROM OLD.staging_key
    OR NEW.sha256 IS DISTINCT FROM OLD.sha256 OR NEW.size IS DISTINCT FROM OLD.size OR NEW.content_type IS DISTINCT FROM OLD.content_type
    OR (OLD.sealed_key IS NOT NULL AND (NEW.sealed_key IS DISTINCT FROM OLD.sealed_key OR NEW.sealed_at IS DISTINCT FROM OLD.sealed_at)) THEN
    RAISE EXCEPTION 'Import asset identity is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'knowledge_history_assets_seal_guard' AND tgrelid = 'knowledge_history_assets'::regclass) THEN
    CREATE TRIGGER knowledge_history_assets_seal_guard BEFORE UPDATE ON knowledge_history_assets FOR EACH ROW EXECUTE FUNCTION guard_sealed_history_asset();
  END IF;
END $$;
