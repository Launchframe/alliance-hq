CREATE OR REPLACE FUNCTION notes_search_text(value text) RETURNS text LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $function$
BEGIN
  value := coalesce(value, '');
  value := regexp_replace(value, $pattern$eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$pattern$, '[redacted-jwt]', 'g');
  value := regexp_replace(value, $pattern$\mBearer\s+[A-Za-z0-9._~+/=-]+$pattern$, 'Bearer [redacted]', 'gi');
  value := regexp_replace(value, $pattern$\m(token|api[_-]?key|password|secret|authorization|cookie)\M\s*[:=]\s*["']?[^"'&,\s]+["']?$pattern$, $replacement$\1=[redacted]$replacement$, 'gi');
  value := regexp_replace(value, $pattern$\m(set-cookie|x-api-key)\M\s*[:=]\s*["']?[^\s"'&,]+$pattern$, $replacement$\1=[redacted]$replacement$, 'gi');
  RETURN regexp_replace(value, $pattern$\m[0-9]{12,20}\M$pattern$, '[redacted-id]', 'g');
END $function$;

CREATE OR REPLACE FUNCTION notes_search_vector(value text) RETURNS tsvector LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN octet_length(value) <= 300000 THEN to_tsvector('simple', notes_search_text(value)) ELSE ''::tsvector END
$$;
CREATE OR REPLACE FUNCTION notes_document_text(title text, body text, decisions jsonb, questions jsonb) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT title || E'\n' || body || E'\n' || coalesce((SELECT string_agg(value, E'\n') FROM jsonb_array_elements_text(decisions) value), '') || E'\n' || coalesce((SELECT string_agg(value, E'\n') FROM jsonb_array_elements_text(questions) value), '')
$$;
CREATE INDEX IF NOT EXISTS performance_notes_search_idx ON performance_notes USING gin(notes_search_vector(notes_document_text(title, body, key_decisions, open_questions)));
CREATE INDEX IF NOT EXISTS officer_action_items_search_idx ON officer_action_items USING gin(notes_search_vector(title || E'\n' || coalesce(description, '')));
CREATE INDEX IF NOT EXISTS officer_chat_messages_search_idx ON officer_chat_messages USING gin(notes_search_vector(original_text));
