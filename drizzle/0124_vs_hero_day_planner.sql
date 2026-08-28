-- Hero Day planner: catalog corrections + commander push profiles

UPDATE "vs_inventory_item_defs"
SET
  "points_by_day" = "points_by_day" || '{"4": 2.5}'::jsonb,
  "updated_at" = now()
WHERE "slug" = 'hero_exp_660'
  AND NOT ("points_by_day" ? '4');

UPDATE "vs_inventory_item_defs"
SET
  "points_by_day" = jsonb_set("points_by_day", '{4}', '25000'::jsonb, true),
  "display_name" = 'Exclusive weapon shard',
  "updated_at" = now()
WHERE "slug" = 'exclusive_weapon_mat';

INSERT INTO "vs_inventory_item_defs" (
  "id",
  "slug",
  "display_name",
  "points_by_day",
  "status",
  "sort_order"
)
VALUES (
  'vsdef_skill_medal',
  'skill_medal',
  'Skill medal',
  '{"4":25}'::jsonb,
  'active',
  405
)
ON CONFLICT ("slug") DO UPDATE
SET
  "display_name" = EXCLUDED."display_name",
  "points_by_day" = EXCLUDED."points_by_day",
  "sort_order" = EXCLUDED."sort_order",
  "updated_at" = now();

CREATE TABLE IF NOT EXISTS "commander_vs_push_profiles" (
  "commander_id" text PRIMARY KEY NOT NULL REFERENCES "commanders"("id") ON DELETE CASCADE,
  "payload" jsonb NOT NULL,
  "reported_by_hq_user_id" text REFERENCES "hq_users"("id") ON DELETE SET NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
