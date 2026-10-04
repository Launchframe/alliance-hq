ALTER TABLE vs_compliance_policies ADD COLUMN IF NOT EXISTS model_version integer NOT NULL DEFAULT 1;
ALTER TABLE vs_compliance_policies ADD COLUMN IF NOT EXISTS allowed_missed_days integer;
ALTER TABLE vs_compliance_policies ADD COLUMN IF NOT EXISTS demotion_unit text;
ALTER TABLE vs_compliance_policies ADD COLUMN IF NOT EXISTS demotion_length integer;
ALTER TABLE vs_compliance_policies ADD COLUMN IF NOT EXISTS promotion_unit text;
ALTER TABLE vs_compliance_policies ADD COLUMN IF NOT EXISTS promotion_length integer;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vs_compliance_policies_model_version_check') THEN
    ALTER TABLE vs_compliance_policies DROP CONSTRAINT vs_compliance_policies_model_version_check;
  END IF;
  ALTER TABLE vs_compliance_policies ADD CONSTRAINT vs_compliance_policies_model_version_check
    CHECK (model_version IN (1, 2));
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vs_compliance_policies_model_shape_check') THEN
    ALTER TABLE vs_compliance_policies DROP CONSTRAINT vs_compliance_policies_model_shape_check;
  END IF;
  ALTER TABLE vs_compliance_policies ADD CONSTRAINT vs_compliance_policies_model_shape_check
    CHECK (
      (model_version = 1
        AND allowed_missed_days IS NULL
        AND demotion_unit IS NULL
        AND demotion_length IS NULL
        AND promotion_unit IS NULL
        AND promotion_length IS NULL)
      OR
      (model_version = 2
        AND allowed_missed_days BETWEEN 0 AND 5
        AND ((demotion_unit = 'days' AND demotion_length BETWEEN 1 AND 312)
          OR (demotion_unit = 'weeks' AND demotion_length BETWEEN 1 AND 52))
        AND ((promotion_unit = 'days' AND promotion_length BETWEEN 1 AND 312)
          OR (promotion_unit = 'weeks' AND promotion_length BETWEEN 1 AND 52)))
    );
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vs_compliance_policies_enabled_minimum_check') THEN
    ALTER TABLE vs_compliance_policies DROP CONSTRAINT vs_compliance_policies_enabled_minimum_check;
  END IF;
  ALTER TABLE vs_compliance_policies ADD CONSTRAINT vs_compliance_policies_enabled_minimum_check
    CHECK (model_version = 2 OR NOT enabled OR weekly_minimum IS NOT NULL);
END $$;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT "roles"."id", 'vs_compliance:settings' FROM "roles"
WHERE "roles"."id" = 'role-officer'
ON CONFLICT DO NOTHING;
