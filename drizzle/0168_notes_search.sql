DROP INDEX IF EXISTS performance_notes_search_idx;--> statement-breakpoint
DROP INDEX IF EXISTS officer_action_items_search_idx;--> statement-breakpoint
DROP INDEX IF EXISTS officer_chat_messages_search_idx;--> statement-breakpoint
DROP FUNCTION IF EXISTS notes_search_vector(text);--> statement-breakpoint
DROP FUNCTION IF EXISTS notes_document_text(text, text, jsonb, jsonb);--> statement-breakpoint
DROP FUNCTION IF EXISTS notes_search_text(text);--> statement-breakpoint
CREATE OR REPLACE FUNCTION notes_search_text(value text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $function$
  SELECT regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(coalesce(value, ''), $pattern$eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$pattern$, '[redacted-jwt]', 'g'),
          $pattern$\mBearer\s+[A-Za-z0-9._~+/=-]+$pattern$, 'Bearer [redacted]', 'gi'),
        $pattern$\m(token|api[_-]?key|password|secret|authorization|cookie)\M\s*[:=]\s*["']?[^"'&,\s]+["']?$pattern$, $replacement$\1=[redacted]$replacement$, 'gi'),
      $pattern$\m(set-cookie|x-api-key)\M\s*[:=]\s*["']?[^\s"'&,]+$pattern$, $replacement$\1=[redacted]$replacement$, 'gi'),
    $pattern$\m[0-9]{12,20}\M$pattern$, '[redacted-id]', 'g')
$function$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION notes_search_vector(value text) RETURNS tsvector LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $function$
  SELECT CASE WHEN octet_length(value) <= 300000 THEN to_tsvector('simple', public.notes_search_text(value)) ELSE ''::tsvector END
$function$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION notes_document_text(title text, body text, decisions jsonb, questions jsonb) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $function$
  SELECT title || E'\n' || body || E'\n' || coalesce((SELECT string_agg(value, E'\n') FROM jsonb_array_elements_text(decisions) value), '') || E'\n' || coalesce((SELECT string_agg(value, E'\n') FROM jsonb_array_elements_text(questions) value), '')
$function$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS performance_notes_search_idx ON performance_notes USING gin(public.notes_search_vector(public.notes_document_text(title, body, key_decisions, open_questions)));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS officer_action_items_search_idx ON officer_action_items USING gin(public.notes_search_vector(title || E'\n' || coalesce(description, '')));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS officer_chat_messages_search_idx ON officer_chat_messages USING gin(public.notes_search_vector(original_text));
