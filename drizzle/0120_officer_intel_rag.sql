CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE officer_intel_chunks (
  id text PRIMARY KEY,
  alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  source_id text NOT NULL,
  session_id text REFERENCES officer_chat_sessions(id) ON DELETE CASCADE,
  locale_code text NOT NULL,
  chunk_text text NOT NULL,
  embedding vector(1536),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX officer_intel_chunks_alliance_source_idx ON officer_intel_chunks (alliance_id, source_type, source_id);

CREATE INDEX officer_intel_chunks_alliance_embedding_idx ON officer_intel_chunks
  USING hnsw (embedding vector_cosine_ops);

CREATE TABLE officer_intel_threads (
  id text PRIMARY KEY,
  alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  created_by_hq_user_id text REFERENCES hq_users(id) ON DELETE SET NULL,
  running_summary text,
  turn_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX officer_intel_threads_alliance_updated_idx ON officer_intel_threads (alliance_id, updated_at);

CREATE TABLE officer_intel_thread_messages (
  id text PRIMARY KEY,
  thread_id text NOT NULL REFERENCES officer_intel_threads(id) ON DELETE CASCADE,
  alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  role text NOT NULL,
  content text NOT NULL,
  citations_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX officer_intel_thread_messages_thread_idx ON officer_intel_thread_messages (thread_id, created_at);
