-- Event→Ashed sync: `uncertain` covers POST-sent-reply-lost; `remote_row_id`
-- binds the created/matched remote row for reconciliation.
ALTER TABLE "hq_event_sync_items" ADD COLUMN IF NOT EXISTS "remote_row_id" text;
ALTER TABLE "hq_event_sync_items" DROP CONSTRAINT IF EXISTS "hq_event_sync_items_status_check";
ALTER TABLE "hq_event_sync_items" ADD CONSTRAINT "hq_event_sync_items_status_check" CHECK ("status" IN ('pending','synced','conflict','failed','unsupported','uncertain'));

-- Evidence batches gain 'retracted' for data-management retraction.
ALTER TABLE "hq_event_evidence_batches" DROP CONSTRAINT IF EXISTS "hq_event_batches_status_check";
ALTER TABLE "hq_event_evidence_batches" ADD CONSTRAINT "hq_event_batches_status_check" CHECK ("status" IN ('staged','committed','superseded','retracted'));
