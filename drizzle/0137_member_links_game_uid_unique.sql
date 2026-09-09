-- Enforce one Last War UID claim per alliance on HQ and Discord member links.
-- Application checks were TOCTOU-only; concurrent link posts could dual-claim.
-- Fail closed if duplicates already exist so operators can clean before unique.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM hq_member_links
    GROUP BY alliance_id, game_uid
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot add hq_member_links_alliance_game_uid_unique: duplicate (alliance_id, game_uid) rows exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM discord_member_links
    GROUP BY alliance_id, game_uid
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot add discord_member_links_alliance_game_uid_unique: duplicate (alliance_id, game_uid) rows exist';
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hq_member_links_alliance_game_uid_unique"
  ON "hq_member_links" ("alliance_id", "game_uid");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "discord_member_links_alliance_game_uid_unique"
  ON "discord_member_links" ("alliance_id", "game_uid");
