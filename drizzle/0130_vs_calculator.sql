ALTER TABLE "game_servers" ADD COLUMN IF NOT EXISTS "shiny_spawn_weekday_a" integer;
ALTER TABLE "game_servers" ADD COLUMN IF NOT EXISTS "shiny_spawn_weekday_b" integer;

ALTER TABLE "alliances" ADD COLUMN IF NOT EXISTS "vs_announcements_enabled" integer NOT NULL DEFAULT 0;

ALTER TABLE "discord_guild_alliances" ADD COLUMN IF NOT EXISTS "vs_announcements_channel_id" text;

CREATE TABLE IF NOT EXISTS "vs_announcement_posts" (
  "id" text PRIMARY KEY NOT NULL,
  "alliance_id" text NOT NULL REFERENCES "alliances"("id") ON DELETE CASCADE,
  "target_date" text NOT NULL,
  "posted_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "vs_announcement_posts_alliance_target_date_unique"
  ON "vs_announcement_posts" ("alliance_id", "target_date");

CREATE INDEX IF NOT EXISTS "vs_announcement_posts_alliance_idx"
  ON "vs_announcement_posts" ("alliance_id");

CREATE TABLE IF NOT EXISTS "vs_inventory_item_defs" (
  "id" text PRIMARY KEY NOT NULL,
  "slug" text NOT NULL UNIQUE,
  "display_name" text NOT NULL,
  "points_by_day" jsonb NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "icon_template_url" text,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "vs_inventory_item_defs_status_sort_idx"
  ON "vs_inventory_item_defs" ("status", "sort_order");

CREATE TABLE IF NOT EXISTS "commander_vs_inventories" (
  "commander_id" text PRIMARY KEY NOT NULL REFERENCES "commanders"("id") ON DELETE CASCADE,
  "quantities" jsonb NOT NULL DEFAULT '{}',
  "reported_by_hq_user_id" text REFERENCES "hq_users"("id") ON DELETE SET NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "commander_vs_inventory_events" (
  "id" text PRIMARY KEY NOT NULL,
  "commander_id" text NOT NULL REFERENCES "commanders"("id") ON DELETE CASCADE,
  "item_slug" text NOT NULL,
  "delta" integer NOT NULL,
  "qty_after" integer NOT NULL,
  "reason" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "commander_vs_inventory_events_commander_created_idx"
  ON "commander_vs_inventory_events" ("commander_id", "created_at");

INSERT INTO "vs_inventory_item_defs" ("id", "slug", "display_name", "points_by_day", "status", "sort_order")
VALUES
  ('vsdef_stamina', 'stamina', 'Stamina', '{"1":375}'::jsonb, 'active', 10),
  ('vsdef_radar_intel', 'radar_intel', 'Radar intel', '{"1":30000,"3":30000}'::jsonb, 'active', 20),
  ('vsdef_hero_exp_660', 'hero_exp_660', 'Hero EXP (660)', '{"1":2.5,"4":2.5}'::jsonb, 'active', 30),
  ('vsdef_drone_battle_data', 'drone_battle_data', 'Drone battle data', '{"1":7.5}'::jsonb, 'active', 40),
  ('vsdef_drone_part', 'drone_part', 'Drone part', '{"1":6250,"3":6250}'::jsonb, 'active', 50),
  ('vsdef_diamond', 'diamond', 'Diamond', '{"1":30,"2":30,"3":30,"4":30,"5":30}'::jsonb, 'active', 60),
  ('vsdef_food_100k', 'food_100k', 'Food (100K)', '{"1":50,"2":50,"5":50}'::jsonb, 'active', 70),
  ('vsdef_iron_100k', 'iron_100k', 'Iron (100K)', '{"1":50,"2":50,"5":50}'::jsonb, 'active', 80),
  ('vsdef_coins_60k', 'coins_60k', 'Coins (60K)', '{"1":50}'::jsonb, 'active', 90),
  ('vsdef_chip_chest_premium_mat', 'chip_chest_premium_mat', 'Premium material chip chest', '{"1":2812.5,"4":2812.5}'::jsonb, 'active', 100),
  ('vsdef_ur_shard', 'ur_shard', 'UR shard', '{"1":25000,"4":25000}'::jsonb, 'active', 110),
  ('vsdef_ssr_shard', 'ssr_shard', 'SSR shard', '{"1":8750,"4":8750}'::jsonb, 'active', 120),
  ('vsdef_sr_shard', 'sr_shard', 'SR shard', '{"1":2500,"4":2500}'::jsonb, 'active', 130),
  ('vsdef_construction_speedup_1m', 'construction_speedup_1m', 'Construction speedup (1m)', '{"2":150}'::jsonb, 'active', 200),
  ('vsdef_ur_truck', 'ur_truck', 'UR truck', '{"2":300000}'::jsonb, 'active', 210),
  ('vsdef_ur_secret_file', 'ur_secret_file', 'UR secret file', '{"2":225000}'::jsonb, 'active', 220),
  ('vsdef_recruit_ticket', 'recruit_ticket', 'Recruit ticket', '{"2":4500,"4":4500}'::jsonb, 'active', 230),
  ('vsdef_armament_material', 'armament_material', 'Armament material', '{"2":2.5,"5":2.5}'::jsonb, 'active', 240),
  ('vsdef_armament_core', 'armament_core', 'Armament core', '{"2":6250,"5":6250}'::jsonb, 'active', 250),
  ('vsdef_research_speedup_1m', 'research_speedup_1m', 'Research speedup (1m)', '{"3":150}'::jsonb, 'active', 300),
  ('vsdef_valor_medal', 'valor_medal', 'Valor medal', '{"3":750,"5":750}'::jsonb, 'active', 310),
  ('vsdef_drone_chest_l7', 'drone_chest_l7', 'Drone chest (Lv.7)', '{"3":2025000}'::jsonb, 'active', 320),
  ('vsdef_drone_chest_l6', 'drone_chest_l6', 'Drone chest (Lv.6)', '{"3":275000}'::jsonb, 'active', 330),
  ('vsdef_drone_chest_l5', 'drone_chest_l5', 'Drone chest (Lv.5)', '{"3":27500}'::jsonb, 'active', 340),
  ('vsdef_honor_medal', 'honor_medal', 'Honor medal', '{"4":5000}'::jsonb, 'active', 400),
  ('vsdef_skill_medal', 'skill_medal', 'Skill medal', '{"4":25}'::jsonb, 'active', 405),
  ('vsdef_exclusive_weapon_mat', 'exclusive_weapon_mat', 'Exclusive weapon shard', '{"4":25000}'::jsonb, 'active', 410),
  ('vsdef_march_speedup_1m', 'march_speedup_1m', 'March speedup (1m)', '{"5":150}'::jsonb, 'active', 500),
  ('vsdef_train_unit_lv6', 'train_unit_lv6', 'Train Lv.6 unit', '{"5":210}'::jsonb, 'active', 510)
ON CONFLICT ("slug") DO NOTHING;
