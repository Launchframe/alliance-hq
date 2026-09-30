DROP INDEX IF EXISTS train_rule_templates_alliance_name_unique;
CREATE UNIQUE INDEX train_rule_templates_alliance_name_unique
  ON train_rule_templates (alliance_id, name)
  WHERE archived_at IS NULL;
