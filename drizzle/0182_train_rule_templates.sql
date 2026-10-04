-- Week templates become data: seven calendar-weekday slots per template.
--
-- HQ presets are rows with alliance_id IS NULL and a stable preset_key. They
-- are created here (not only by the seed) because train_week_schedules must
-- be able to point at them in the same migration. scripts/trains/seed.mjs
-- re-upserts the same ids on every deploy.

CREATE TABLE IF NOT EXISTS train_rule_templates (
  id text PRIMARY KEY,
  alliance_id text REFERENCES alliances(id) ON DELETE CASCADE,
  preset_key text UNIQUE,
  name text NOT NULL,
  description text,
  days jsonb NOT NULL,
  created_by_hq_user_id text REFERENCES hq_users(id) ON DELETE SET NULL,
  source_template_id text,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- One name per alliance. Presets (alliance_id IS NULL) are covered by
-- preset_key instead; NULLs do not collide in a UNIQUE constraint.
CREATE UNIQUE INDEX IF NOT EXISTS train_rule_templates_alliance_name_unique
  ON train_rule_templates (alliance_id, name);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS train_rule_template_archives (
  id text PRIMARY KEY,
  alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  template_id text NOT NULL REFERENCES train_rule_templates(id) ON DELETE CASCADE,
  archived_by_hq_user_id text REFERENCES hq_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS train_rule_template_archives_unique
  ON train_rule_template_archives (alliance_id, template_id);
--> statement-breakpoint

-- HQ presets. `days` mirrors PRESET_WEEK_RULES in
-- src/lib/trains/rules/presets.shared.ts; a unit test keeps them in lockstep.
INSERT INTO train_rule_templates (id, preset_key, name, days)
VALUES
  ('tmpl_preset_vs_push_week', 'vs_push_week', 'VS Push week', '{
    "mon": {"conductorRule": {"kind":"rank_pool","pool":"r4_plus","draw":"wheel"}, "vipRule": {"kind":"event_top_x","eventKey":"capitol_war","topN":10}},
    "tue": {"conductorRule": {"kind":"vs_top_n","topN":1}, "vipRule": null},
    "wed": {"conductorRule": {"kind":"vs_top_n","topN":10}, "vipRule": null},
    "thu": {"conductorRule": {"kind":"vs_top_n","topN":10}, "vipRule": null},
    "fri": {"conductorRule": {"kind":"vs_top_n","topN":1}, "vipRule": null},
    "sat": {"conductorRule": {"kind":"vs_top_n","topN":10}, "vipRule": null},
    "sun": {"conductorRule": {"kind":"rank_pool","pool":"r4_plus","draw":"wheel"}, "vipRule": {"kind":"event_top_x","eventKey":"capitol_war","topN":10}}
  }'::jsonb),
  ('tmpl_preset_vs_push_week_lead_time', 'vs_push_week_lead_time', 'VS push (lead time)', '{
    "mon": {"conductorRule": {"kind":"rank_pool","pool":"r4_plus","draw":"wheel"}, "vipRule": {"kind":"event_top_x","eventKey":"capitol_war","topN":10}},
    "tue": {"conductorRule": {"kind":"rank_pool","pool":"r4_plus","draw":"wheel"}, "vipRule": {"kind":"event_top_x","eventKey":"capitol_war","topN":10}},
    "wed": {"conductorRule": {"kind":"vs_top_n","topN":10}, "vipRule": null},
    "thu": {"conductorRule": {"kind":"vs_top_n","topN":10}, "vipRule": null},
    "fri": {"conductorRule": {"kind":"vs_top_n","topN":1}, "vipRule": null},
    "sat": {"conductorRule": {"kind":"vs_top_n","topN":10}, "vipRule": null},
    "sun": {"conductorRule": null, "vipRule": {"kind":"none"}}
  }'::jsonb),
  ('tmpl_preset_economy_week', 'economy_week', 'Economy week', '{
    "mon": {"conductorRule": {"kind":"rank_pool","pool":"r3","draw":"wheel"}, "vipRule": null},
    "tue": {"conductorRule": {"kind":"rank_pool","pool":"r3","draw":"wheel"}, "vipRule": null},
    "wed": {"conductorRule": {"kind":"rank_pool","pool":"r3","draw":"wheel"}, "vipRule": null},
    "thu": {"conductorRule": {"kind":"rank_pool","pool":"r3","draw":"wheel"}, "vipRule": null},
    "fri": {"conductorRule": {"kind":"rank_pool","pool":"r3","draw":"wheel"}, "vipRule": null},
    "sat": {"conductorRule": {"kind":"rank_pool","pool":"r3","draw":"wheel"}, "vipRule": null},
    "sun": {"conductorRule": {"kind":"rank_pool","pool":"r3","draw":"wheel"}, "vipRule": null}
  }'::jsonb),
  ('tmpl_preset_price_is_right', 'price_is_right', 'The Price Is Freight', '{
    "mon": {"conductorRule": null, "vipRule": {"kind":"none"}},
    "tue": {"conductorRule": {"kind":"price_is_freight","board":"weekday"}, "vipRule": null},
    "wed": {"conductorRule": {"kind":"price_is_freight","board":"weekday"}, "vipRule": null},
    "thu": {"conductorRule": {"kind":"price_is_freight","board":"weekday"}, "vipRule": null},
    "fri": {"conductorRule": {"kind":"price_is_freight","board":"weekday"}, "vipRule": null},
    "sat": {"conductorRule": {"kind":"price_is_freight","board":"heavy_hitter"}, "vipRule": null},
    "sun": {"conductorRule": null, "vipRule": {"kind":"none"}}
  }'::jsonb),
  ('tmpl_preset_r3_recognition', 'r3_recognition', 'R3 recognition', '{
    "mon": {"conductorRule": {"kind":"rank_pool","pool":"r3","draw":"manual"}, "vipRule": null},
    "tue": {"conductorRule": {"kind":"rank_pool","pool":"r3","draw":"manual"}, "vipRule": null},
    "wed": {"conductorRule": {"kind":"rank_pool","pool":"r3","draw":"manual"}, "vipRule": null},
    "thu": {"conductorRule": {"kind":"rank_pool","pool":"r3","draw":"manual"}, "vipRule": null},
    "fri": {"conductorRule": {"kind":"rank_pool","pool":"r3","draw":"manual"}, "vipRule": null},
    "sat": {"conductorRule": {"kind":"rank_pool","pool":"r3","draw":"manual"}, "vipRule": null},
    "sun": {"conductorRule": {"kind":"rank_pool","pool":"r3","draw":"manual"}, "vipRule": null}
  }'::jsonb),
  ('tmpl_preset_r4_train_week', 'r4_train_week', 'R4 Week', '{
    "mon": {"conductorRule": {"kind":"rank_pool","pool":"r4_plus","draw":"wheel"}, "vipRule": null},
    "tue": {"conductorRule": {"kind":"rank_pool","pool":"r4_plus","draw":"wheel"}, "vipRule": null},
    "wed": {"conductorRule": {"kind":"rank_pool","pool":"r4_plus","draw":"wheel"}, "vipRule": null},
    "thu": {"conductorRule": {"kind":"rank_pool","pool":"r4_plus","draw":"wheel"}, "vipRule": null},
    "fri": {"conductorRule": {"kind":"rank_pool","pool":"r4_plus","draw":"wheel"}, "vipRule": null},
    "sat": {"conductorRule": {"kind":"rank_pool","pool":"r4_plus","draw":"wheel"}, "vipRule": null},
    "sun": {"conductorRule": {"kind":"rank_pool","pool":"r4_plus","draw":"wheel"}, "vipRule": null}
  }'::jsonb),
  ('tmpl_preset_donations_week', 'donations_week', 'Donations week', '{
    "mon": {"conductorRule": {"kind":"donations_top"}, "vipRule": {"kind":"donations_second"}},
    "tue": {"conductorRule": {"kind":"donations_top"}, "vipRule": {"kind":"donations_second"}},
    "wed": {"conductorRule": {"kind":"donations_top"}, "vipRule": {"kind":"donations_second"}},
    "thu": {"conductorRule": {"kind":"donations_top"}, "vipRule": {"kind":"donations_second"}},
    "fri": {"conductorRule": {"kind":"donations_top"}, "vipRule": {"kind":"donations_second"}},
    "sat": {"conductorRule": {"kind":"donations_top"}, "vipRule": {"kind":"donations_second"}},
    "sun": {"conductorRule": {"kind":"donations_top"}, "vipRule": {"kind":"donations_second"}}
  }'::jsonb),
  ('tmpl_preset_custom', 'custom', 'Custom', '{
    "mon": {"conductorRule": null, "vipRule": {"kind":"none"}},
    "tue": {"conductorRule": null, "vipRule": {"kind":"none"}},
    "wed": {"conductorRule": null, "vipRule": {"kind":"none"}},
    "thu": {"conductorRule": null, "vipRule": {"kind":"none"}},
    "fri": {"conductorRule": null, "vipRule": {"kind":"none"}},
    "sat": {"conductorRule": null, "vipRule": {"kind":"none"}},
    "sun": {"conductorRule": null, "vipRule": {"kind":"none"}}
  }'::jsonb)
ON CONFLICT (preset_key) DO NOTHING;
--> statement-breakpoint

ALTER TABLE train_day_configs ADD COLUMN IF NOT EXISTS source_template_id text;
--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'train_day_configs'::regclass
      AND attname = 'source_template_key' AND NOT attisdropped
  ) THEN
    UPDATE train_day_configs d
    SET source_template_id = t.id
    FROM train_rule_templates t
    WHERE t.preset_key = d.source_template_key;
  END IF;
END $$;
--> statement-breakpoint

ALTER TABLE train_day_configs DROP COLUMN IF EXISTS source_template_key;
--> statement-breakpoint

ALTER TABLE train_day_configs
  ADD CONSTRAINT train_day_configs_source_template_fk
  FOREIGN KEY (source_template_id) REFERENCES train_rule_templates(id)
  ON DELETE SET NULL;
--> statement-breakpoint

ALTER TABLE train_week_schedules ADD COLUMN IF NOT EXISTS template_id text;
--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'train_week_schedules'::regclass
      AND attname = 'template_type' AND NOT attisdropped
  ) THEN
    UPDATE train_week_schedules w
    SET template_id = t.id
    FROM train_rule_templates t
    WHERE t.preset_key = w.template_type;
  END IF;
END $$;
--> statement-breakpoint

ALTER TABLE train_week_schedules DROP COLUMN IF EXISTS template_type;
--> statement-breakpoint

ALTER TABLE train_week_schedules
  ADD CONSTRAINT train_week_schedules_template_fk
  FOREIGN KEY (template_id) REFERENCES train_rule_templates(id)
  ON DELETE SET NULL;
--> statement-breakpoint

-- Normalize week_start to the Monday calendar week.
--
-- trainWeekStartDow is now display-only, so a schedule row must not be keyed
-- by a preference the officer can change. Distinct anchor dates map to
-- distinct Mondays, so this is injective in theory; where a duplicate exists
-- anyway (an alliance that changed its start day and wrote both keys), keep
-- the row backing the most day configs and log the discard.
DO $$
DECLARE
  dup RECORD;
  keep_id text;
BEGIN
  FOR dup IN
    SELECT alliance_id,
           to_char(date_trunc('week', week_start::date), 'YYYY-MM-DD') AS monday,
           array_agg(id) AS ids
    FROM train_week_schedules
    GROUP BY 1, 2
    HAVING count(*) > 1
  LOOP
    SELECT s.id INTO keep_id
    FROM train_week_schedules s
    WHERE s.id = ANY(dup.ids)
    ORDER BY (
      SELECT count(*) FROM train_day_configs d WHERE d.week_schedule_id = s.id
    ) DESC, s.updated_at DESC, s.id ASC
    LIMIT 1;

    RAISE WARNING
      'train_week_schedules: alliance % week % had % rows; keeping % and repointing its day configs',
      dup.alliance_id, dup.monday, array_length(dup.ids, 1), keep_id;

    -- Re-point first: day configs hold the rules and must not be deleted
    -- with the losing schedule row.
    UPDATE train_day_configs
    SET week_schedule_id = keep_id
    WHERE week_schedule_id = ANY(dup.ids)
      AND week_schedule_id <> keep_id;

    DELETE FROM train_week_schedules
    WHERE id = ANY(dup.ids) AND id <> keep_id;
  END LOOP;

  UPDATE train_week_schedules
  SET week_start = to_char(date_trunc('week', week_start::date), 'YYYY-MM-DD')
  WHERE week_start <> to_char(date_trunc('week', week_start::date), 'YYYY-MM-DD');
END $$;
