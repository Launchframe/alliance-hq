ALTER TABLE "alliances" ADD COLUMN IF NOT EXISTS "lastrank_alliance_id" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "alliances_lastrank_alliance_id_unique"
  ON "alliances" ("lastrank_alliance_id")
  WHERE "lastrank_alliance_id" IS NOT NULL;
