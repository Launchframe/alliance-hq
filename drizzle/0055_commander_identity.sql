CREATE TABLE IF NOT EXISTS "commanders" (
  "id" text PRIMARY KEY NOT NULL,
  "game_uid" text NOT NULL,
  "primary_name" text,
  "profession" text,
  "professional_level" integer,
  "member_level" integer,
  "hero_power_m" double precision,
  "power_level" text,
  "current_kills" double precision,
  "current_total_hero_power" double precision,
  "current_squad_power_json" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "commanders_game_uid_unique"
  ON "commanders" ("game_uid");

CREATE INDEX IF NOT EXISTS "commanders_game_uid_idx"
  ON "commanders" ("game_uid");

CREATE TABLE IF NOT EXISTS "hq_user_commanders" (
  "id" text PRIMARY KEY NOT NULL,
  "hq_user_id" text NOT NULL REFERENCES "hq_users"("id") ON DELETE CASCADE,
  "commander_id" text NOT NULL REFERENCES "commanders"("id") ON DELETE CASCADE,
  "is_primary" boolean DEFAULT false NOT NULL,
  "linked_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "hq_user_commanders_user_commander_unique"
  ON "hq_user_commanders" ("hq_user_id", "commander_id");

CREATE INDEX IF NOT EXISTS "hq_user_commanders_commander_idx"
  ON "hq_user_commanders" ("commander_id");

CREATE TABLE IF NOT EXISTS "commander_alliance_memberships" (
  "id" text PRIMARY KEY NOT NULL,
  "commander_id" text NOT NULL REFERENCES "commanders"("id") ON DELETE CASCADE,
  "alliance_id" text NOT NULL REFERENCES "alliances"("id") ON DELETE CASCADE,
  "ashed_member_id" text NOT NULL,
  "ashed_alliance_id" text,
  "status" text DEFAULT 'active' NOT NULL,
  "joined_at" timestamp with time zone DEFAULT now() NOT NULL,
  "left_at" timestamp with time zone,
  "alliance_rank" integer,
  "alliance_rank_title" text,
  "roster_name_at_membership" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "commander_alliance_memberships_alliance_member_unique"
  ON "commander_alliance_memberships" ("alliance_id", "ashed_member_id");

CREATE UNIQUE INDEX IF NOT EXISTS "commander_alliance_memberships_active_unique"
  ON "commander_alliance_memberships" ("commander_id", "alliance_id")
  WHERE "left_at" IS NULL;

CREATE INDEX IF NOT EXISTS "commander_alliance_memberships_commander_idx"
  ON "commander_alliance_memberships" ("commander_id");

CREATE INDEX IF NOT EXISTS "commander_alliance_memberships_alliance_idx"
  ON "commander_alliance_memberships" ("alliance_id");

-- Backfill commanders from roster rows with known UIDs (prefer freshest row per UID).
INSERT INTO "commanders" (
  "id",
  "game_uid",
  "primary_name",
  "profession",
  "professional_level",
  "member_level",
  "hero_power_m",
  "power_level",
  "current_kills",
  "current_total_hero_power",
  "current_squad_power_json",
  "created_at",
  "updated_at"
)
SELECT
  'cmd_' || md5(src.game_uid),
  src.game_uid,
  src.primary_name,
  src.profession,
  src.professional_level,
  src.member_level,
  src.hero_power_m,
  src.power_level,
  src.current_kills,
  src.current_total_hero_power,
  src.current_squad_power_json,
  src.created_at,
  src.updated_at
FROM (
  SELECT DISTINCT ON (trim("game_uid"))
    trim("game_uid") AS game_uid,
    "current_name" AS primary_name,
    "profession",
    "professional_level",
    "member_level",
    "hero_power_m",
    "power_level",
    "current_kills",
    "current_total_hero_power",
    "current_squad_power_json",
    "created_at",
    "updated_at"
  FROM "alliance_members"
  WHERE "game_uid" IS NOT NULL AND trim("game_uid") <> ''
  ORDER BY trim("game_uid"), "updated_at" DESC
) src
ON CONFLICT ("game_uid") DO UPDATE SET
  "primary_name" = COALESCE(EXCLUDED."primary_name", "commanders"."primary_name"),
  "profession" = COALESCE(EXCLUDED."profession", "commanders"."profession"),
  "professional_level" = COALESCE(EXCLUDED."professional_level", "commanders"."professional_level"),
  "member_level" = COALESCE(EXCLUDED."member_level", "commanders"."member_level"),
  "hero_power_m" = COALESCE(EXCLUDED."hero_power_m", "commanders"."hero_power_m"),
  "power_level" = COALESCE(EXCLUDED."power_level", "commanders"."power_level"),
  "current_kills" = COALESCE(EXCLUDED."current_kills", "commanders"."current_kills"),
  "current_total_hero_power" = COALESCE(EXCLUDED."current_total_hero_power", "commanders"."current_total_hero_power"),
  "current_squad_power_json" = COALESCE(EXCLUDED."current_squad_power_json", "commanders"."current_squad_power_json"),
  "updated_at" = GREATEST("commanders"."updated_at", EXCLUDED."updated_at");

-- UIDs known only from member links / tenure (no roster stats yet).
INSERT INTO "commanders" (
  "id",
  "game_uid",
  "primary_name",
  "created_at",
  "updated_at"
)
SELECT
  'cmd_' || md5(src.game_uid),
  src.game_uid,
  src.primary_name,
  now(),
  now()
FROM (
  SELECT DISTINCT ON (uid.game_uid)
    uid.game_uid,
    uid.primary_name
  FROM (
    SELECT trim("game_uid") AS game_uid, "member_display_name" AS primary_name, "linked_at"
    FROM "hq_member_links"
    WHERE "game_uid" IS NOT NULL AND trim("game_uid") <> ''
    UNION ALL
    SELECT trim("game_uid"), "member_display_name", "linked_at"
    FROM "discord_member_links"
    WHERE "game_uid" IS NOT NULL AND trim("game_uid") <> ''
    UNION ALL
    SELECT trim("game_uid"), NULL, "joined_at"
    FROM "member_alliance_tenure"
    WHERE "game_uid" IS NOT NULL AND trim("game_uid") <> ''
  ) uid
  ORDER BY uid.game_uid, uid.linked_at DESC NULLS LAST
) src
ON CONFLICT ("game_uid") DO UPDATE SET
  "primary_name" = COALESCE(EXCLUDED."primary_name", "commanders"."primary_name"),
  "updated_at" = now();

-- Alliance memberships from roster rows with UIDs.
INSERT INTO "commander_alliance_memberships" (
  "id",
  "commander_id",
  "alliance_id",
  "ashed_member_id",
  "ashed_alliance_id",
  "status",
  "joined_at",
  "left_at",
  "alliance_rank",
  "alliance_rank_title",
  "roster_name_at_membership",
  "created_at",
  "updated_at"
)
SELECT
  'cam_' || md5(c."game_uid" || ':' || am."alliance_id" || ':' || am."ashed_member_id"),
  c."id",
  am."alliance_id",
  am."ashed_member_id",
  am."ashed_alliance_id",
  CASE WHEN am."status" = 'active' THEN 'active' ELSE 'former' END,
  COALESCE(mat."joined_at", am."created_at"),
  mat."left_at",
  am."alliance_rank",
  am."alliance_rank_title",
  am."current_name",
  now(),
  now()
FROM "alliance_members" am
INNER JOIN "commanders" c ON c."game_uid" = trim(am."game_uid")
LEFT JOIN "member_alliance_tenure" mat
  ON mat."alliance_id" = am."alliance_id"
 AND mat."ashed_member_id" = am."ashed_member_id"
 AND mat."left_at" IS NULL
WHERE am."game_uid" IS NOT NULL AND trim(am."game_uid") <> ''
ON CONFLICT ("alliance_id", "ashed_member_id") DO NOTHING;

-- Tenure-only memberships when roster row lacks a denormalized UID.
INSERT INTO "commander_alliance_memberships" (
  "id",
  "commander_id",
  "alliance_id",
  "ashed_member_id",
  "status",
  "joined_at",
  "left_at",
  "created_at",
  "updated_at"
)
SELECT
  'cam_' || md5(c."game_uid" || ':' || mat."alliance_id" || ':' || mat."ashed_member_id"),
  c."id",
  mat."alliance_id",
  mat."ashed_member_id",
  CASE WHEN mat."left_at" IS NULL THEN 'active' ELSE 'former' END,
  mat."joined_at",
  mat."left_at",
  now(),
  now()
FROM "member_alliance_tenure" mat
INNER JOIN "commanders" c ON c."game_uid" = trim(mat."game_uid")
WHERE NOT EXISTS (
  SELECT 1
  FROM "commander_alliance_memberships" cam
  WHERE cam."alliance_id" = mat."alliance_id"
    AND cam."ashed_member_id" = mat."ashed_member_id"
)
ON CONFLICT ("alliance_id", "ashed_member_id") DO NOTHING;

-- HQ user ↔ Commander ownership from web member links.
INSERT INTO "hq_user_commanders" (
  "id",
  "hq_user_id",
  "commander_id",
  "is_primary",
  "linked_at",
  "updated_at"
)
SELECT
  'huc_' || md5(hml."hq_user_id" || ':' || c."id"),
  hml."hq_user_id",
  c."id",
  COALESCE(hu."primary_game_uid" = c."game_uid", false),
  hml."linked_at",
  now()
FROM "hq_member_links" hml
INNER JOIN "commanders" c ON c."game_uid" = trim(hml."game_uid")
LEFT JOIN "hq_users" hu ON hu."id" = hml."hq_user_id"
ON CONFLICT ("hq_user_id", "commander_id") DO NOTHING;
