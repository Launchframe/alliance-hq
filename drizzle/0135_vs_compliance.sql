CREATE TABLE IF NOT EXISTS "vs_compliance_policies" (
  "id" text PRIMARY KEY,
  "alliance_id" text NOT NULL REFERENCES "alliances"("id") ON DELETE CASCADE,
  "version" integer NOT NULL CHECK ("version" > 0),
  "effective_week" text NOT NULL CHECK ("effective_week" ~ '^\d{4}-\d{2}-\d{2}$' AND extract(isodow FROM "effective_week"::date) = 7),
  "enabled" boolean NOT NULL DEFAULT false,
  "daily_target" bigint NOT NULL DEFAULT 7200000 CHECK ("daily_target" BETWEEN 1 AND 9007199254740991),
  "weekly_minimum" bigint CHECK ("weekly_minimum" BETWEEN 1 AND 9007199254740991),
  "leeway_pct" integer NOT NULL DEFAULT 0 CHECK ("leeway_pct" BETWEEN 0 AND 100),
  "preset" text NOT NULL DEFAULT 'rank_aware' CHECK ("preset" IN ('rank_aware', 'consecutive')),
  "removal_threshold" integer NOT NULL DEFAULT 3 CHECK ("removal_threshold" >= 3),
  "created_by_hq_user_id" text REFERENCES "hq_users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "vs_compliance_policies_enabled_minimum_check" CHECK (NOT "enabled" OR "weekly_minimum" IS NOT NULL),
  CONSTRAINT "vs_compliance_policies_alliance_version_unique" UNIQUE ("alliance_id", "version")
);

CREATE INDEX IF NOT EXISTS "vs_compliance_policies_alliance_week_idx" ON "vs_compliance_policies" ("alliance_id", "effective_week");

INSERT INTO "permissions" ("id", "description") VALUES
  ('vs_compliance:read', 'VS compliance'),
  ('vs_compliance:manage', 'Confirm in-game action'),
  ('vs_compliance:settings', 'VS membership minimums')
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT "roles"."id", "permissions"."id" FROM "roles" CROSS JOIN "permissions"
WHERE "roles"."id" IN ('role-owner', 'role-maintainer', 'role-officer')
  AND "permissions"."id" IN ('vs_compliance:read', 'vs_compliance:manage')
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT "roles"."id", 'vs_compliance:settings' FROM "roles"
WHERE "roles"."id" IN ('role-owner', 'role-maintainer')
ON CONFLICT DO NOTHING;
