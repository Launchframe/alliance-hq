-- Scoreboard create/rename offers default on; backfill officers and maintainers.
ALTER TABLE "hq_users"
  ALTER COLUMN "offer_scoreboard_new_members" SET DEFAULT true;
--> statement-breakpoint
ALTER TABLE "hq_users"
  ALTER COLUMN "offer_scoreboard_member_names" SET DEFAULT true;
--> statement-breakpoint
UPDATE "hq_users"
SET
  "offer_scoreboard_new_members" = true,
  "offer_scoreboard_member_names" = true,
  "updated_at" = NOW()
WHERE "is_platform_maintainer" = 1
   OR "id" IN (
     SELECT DISTINCT am."hq_user_id"
     FROM "alliance_memberships" am
     INNER JOIN "roles" r ON r."id" = am."role_id"
     WHERE am."status" = 'active'
       AND r."name" IN ('officer', 'owner', 'maintainer')
   );
