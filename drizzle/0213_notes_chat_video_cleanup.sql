ALTER TABLE "knowledge_history_imports" DROP CONSTRAINT IF EXISTS "knowledge_history_imports_kind_check";--> statement-breakpoint
ALTER TABLE "knowledge_history_imports" ADD CONSTRAINT "knowledge_history_imports_kind_check" CHECK ("kind" IN ('text','markdown','discord_json','screenshots','video'));--> statement-breakpoint
ALTER TABLE "knowledge_history_imports" DROP CONSTRAINT IF EXISTS "knowledge_history_imports_state_check";--> statement-breakpoint
ALTER TABLE "knowledge_history_imports" ADD CONSTRAINT "knowledge_history_imports_state_check" CHECK ("state" IN ('uploading','queued','processing','pending_approval','review','committed','cancelled','failed'));--> statement-breakpoint
ALTER TABLE "knowledge_history_assets" DROP CONSTRAINT IF EXISTS "knowledge_history_assets_size_check";--> statement-breakpoint
ALTER TABLE "knowledge_history_assets" ADD CONSTRAINT "knowledge_history_assets_size_check" CHECK ("size" > 0 AND "size" <= 536870912);--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_sealed_history_asset() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.import_id IS DISTINCT FROM OLD.import_id OR NEW.alliance_id IS DISTINCT FROM OLD.alliance_id
    OR NEW.position IS DISTINCT FROM OLD.position OR NEW.staging_key IS DISTINCT FROM OLD.staging_key
    OR NEW.sha256 IS DISTINCT FROM OLD.sha256 OR NEW.size IS DISTINCT FROM OLD.size OR NEW.content_type IS DISTINCT FROM OLD.content_type THEN
    RAISE EXCEPTION 'Import asset identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.sealed_key IS NOT NULL AND (NEW.sealed_key IS DISTINCT FROM OLD.sealed_key OR NEW.sealed_at IS DISTINCT FROM OLD.sealed_at) THEN
    IF NOT (
      NEW.sealed_key IS NULL AND NEW.sealed_at IS NULL
      AND EXISTS (
        SELECT 1 FROM knowledge_history_imports i
        WHERE i.id = OLD.import_id AND i.alliance_id = OLD.alliance_id
          AND i.kind = 'video' AND i.state = 'committed' AND i.source_deleted_at IS NOT NULL
      )
    ) THEN
      RAISE EXCEPTION 'Import asset identity is immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_history_imports_source_cleanup_idx"
ON "knowledge_history_imports" ("source_delete_after", "id")
WHERE "kind" = 'video' AND "state" = 'committed' AND "source_deleted_at" IS NULL;
