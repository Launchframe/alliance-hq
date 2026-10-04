ALTER TABLE "audit_log"
  ADD COLUMN IF NOT EXISTS "severity" text DEFAULT 'update' NOT NULL;
