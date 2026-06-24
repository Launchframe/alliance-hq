ALTER TABLE "inbox_reminder_items" ADD COLUMN IF NOT EXISTS "resource_id" text;

CREATE INDEX IF NOT EXISTS "inbox_reminder_items_resource_id_idx"
  ON "inbox_reminder_items" ("resource_id")
  WHERE "resource_id" IS NOT NULL;
