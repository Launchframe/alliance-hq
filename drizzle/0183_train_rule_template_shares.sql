-- Share codes for alliance-authored week templates.
--
-- One active code per template, rotatable and revocable. Stored hashed like
-- alliance join codes so a database read cannot hand out working codes; the
-- hint is the last four characters, for "is this the code I sent?".
--
-- Presets need no share code: every alliance already has them.

ALTER TABLE train_rule_templates
  ADD COLUMN IF NOT EXISTS share_code_hash text;
--> statement-breakpoint

ALTER TABLE train_rule_templates
  ADD COLUMN IF NOT EXISTS share_code_hint text;
--> statement-breakpoint

ALTER TABLE train_rule_templates
  ADD COLUMN IF NOT EXISTS shared_at timestamptz;
--> statement-breakpoint

-- Lookup is by hash, and a hash collision would let one code resolve two
-- templates. Partial so the many un-shared templates do not collide on NULL.
CREATE UNIQUE INDEX IF NOT EXISTS train_rule_templates_share_code_hash_unique
  ON train_rule_templates (share_code_hash)
  WHERE share_code_hash IS NOT NULL;
