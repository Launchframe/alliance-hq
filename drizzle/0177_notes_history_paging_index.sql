CREATE INDEX IF NOT EXISTS knowledge_history_imports_page_idx
  ON knowledge_history_imports (alliance_id, updated_at DESC, id DESC);
