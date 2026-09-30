ALTER TABLE knowledge_ai_usage DROP CONSTRAINT IF EXISTS knowledge_ai_usage_operation_check;
ALTER TABLE knowledge_ai_usage ADD CONSTRAINT knowledge_ai_usage_operation_check CHECK(operation IN ('index', 'query', 'generate'));
ALTER TABLE officer_intel_threads ADD COLUMN IF NOT EXISTS knowledge_version integer NOT NULL DEFAULT 0;
ALTER TABLE officer_intel_threads ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE officer_intel_threads ADD COLUMN IF NOT EXISTS active_job_id text;
CREATE TABLE IF NOT EXISTS knowledge_generation_jobs (
  id text PRIMARY KEY, alliance_id text NOT NULL, resource_id text NOT NULL UNIQUE, requester_id text NOT NULL, session_id text NOT NULL,
  kind text NOT NULL CHECK(kind IN ('synthesize','localize','ask','insight')), locale text NOT NULL CHECK(locale IN ('en-US','pt-BR')), model text NOT NULL, question text NOT NULL DEFAULT '',
  evidence jsonb NOT NULL, input_ids jsonb NOT NULL, context jsonb NOT NULL DEFAULT '[]', parts jsonb NOT NULL DEFAULT '[]', review jsonb,
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','ready','accepted','cancelled','failed')),
  version integer NOT NULL DEFAULT 1, cursor integer NOT NULL DEFAULT 0 CHECK(cursor BETWEEN 0 AND 120), attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3), error_code text, lease_token text, lease_expires_at timestamptz,
  thread_id text REFERENCES officer_intel_threads(id) ON DELETE RESTRICT, thread_version integer, note_id text,
  available_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_generation_identity_unique UNIQUE(id, alliance_id),
  CONSTRAINT knowledge_generation_resource_fk FOREIGN KEY(resource_id, alliance_id) REFERENCES knowledge_resources(id, alliance_id) ON DELETE RESTRICT,
  CONSTRAINT knowledge_generation_note_fk FOREIGN KEY(note_id, alliance_id) REFERENCES performance_notes(id, alliance_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS knowledge_generation_claim_idx ON knowledge_generation_jobs(state, available_at);
CREATE TABLE IF NOT EXISTS knowledge_generated_documents (
  note_id text PRIMARY KEY, alliance_id text NOT NULL, job_id text NOT NULL UNIQUE, kind text NOT NULL, locale text NOT NULL, evidence jsonb NOT NULL,
  CONSTRAINT knowledge_generated_document_note_fk FOREIGN KEY(note_id, alliance_id) REFERENCES performance_notes(id, alliance_id) ON DELETE RESTRICT,
  CONSTRAINT knowledge_generated_document_job_fk FOREIGN KEY(job_id, alliance_id) REFERENCES knowledge_generation_jobs(id, alliance_id) ON DELETE RESTRICT
);
