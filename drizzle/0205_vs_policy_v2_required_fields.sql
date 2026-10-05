DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vs_compliance_policies_v2_required_fields_check'
      AND conrelid = 'vs_compliance_policies'::regclass
  ) THEN
    ALTER TABLE vs_compliance_policies
      ADD CONSTRAINT vs_compliance_policies_v2_required_fields_check
      CHECK (
        model_version <> 2 OR (
          allowed_missed_days IS NOT NULL
          AND demotion_unit IS NOT NULL
          AND demotion_length IS NOT NULL
          AND promotion_unit IS NOT NULL
          AND promotion_length IS NOT NULL
        )
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM vs_compliance_policies
    WHERE model_version = 2
      AND (allowed_missed_days IS NULL OR demotion_unit IS NULL OR demotion_length IS NULL
        OR promotion_unit IS NULL OR promotion_length IS NULL)
  ) THEN
    ALTER TABLE vs_compliance_policies VALIDATE CONSTRAINT vs_compliance_policies_v2_required_fields_check;
  ELSE
    RAISE WARNING 'VS policy v2 required-fields constraint remains NOT VALID; inspect existing invalid policies before activation';
  END IF;
END $$;
