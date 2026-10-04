-- Typed conductor / VIP rules replace the mechanism + paintTemplate + topN triple.
--
-- The CASE expressions below are the SQL twin of `decodeConductorRule` /
-- `decodeVipRule` in src/lib/trains/rules/encode.shared.ts. The parity table in
-- encode.shared.test.ts is the contract: change one side and you must change
-- the other. This migration drops columns — there is no rollback.

ALTER TABLE train_day_configs ADD COLUMN IF NOT EXISTS conductor_rule jsonb;
--> statement-breakpoint
ALTER TABLE train_day_configs ADD COLUMN IF NOT EXISTS vip_rule jsonb;
--> statement-breakpoint
ALTER TABLE train_day_configs ADD COLUMN IF NOT EXISTS source_template_key text;
--> statement-breakpoint

-- Backfill day configs. Paint template wins over the stored mechanism: the
-- roll path keyed on paint, so paint is what actually ran.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'train_day_configs'::regclass
      AND attname = 'conductor_mechanism' AND NOT attisdropped
  ) THEN
    WITH src AS (
      SELECT
        id,
        conductor_config->>'paintTemplate' AS paint,
        CASE
          WHEN conductor_config->>'topN' ~ '^[0-9]+$'
            THEN (conductor_config->>'topN')::int
        END AS top_n,
        EXTRACT(DOW FROM date::date)::int AS dow,
        conductor_mechanism AS mech,
        vip_mechanism AS vip_mech,
        vip_config AS vip_cfg
      FROM train_day_configs
    )
    UPDATE train_day_configs d
    SET
      source_template_key = src.paint,
      conductor_rule = CASE
        WHEN src.paint = 'takedown_week'
          THEN jsonb_build_object('kind', 'price_is_freight', 'board', 'heavy_hitter')
        WHEN src.paint = 'price_is_right' AND src.dow = 6
          THEN jsonb_build_object('kind', 'price_is_freight', 'board', 'heavy_hitter')
        WHEN src.paint IN ('price_is_right', 'price_is_right_weekdays')
          THEN jsonb_build_object('kind', 'price_is_freight', 'board', 'weekday')
        WHEN src.paint = 'r4_event_vip'
          THEN jsonb_build_object('kind', 'rank_pool', 'pool', 'r4_plus', 'draw', 'wheel')
        WHEN src.paint = 'top_vs'
          THEN jsonb_build_object('kind', 'vs_top_n', 'topN',
            CASE WHEN src.top_n IN (1, 3, 5, 10) THEN src.top_n ELSE 10 END)
        WHEN src.paint = 'top_vr'
          THEN jsonb_build_object('kind', 'vr_top_n', 'topN',
            CASE WHEN src.top_n IN (3, 5, 10) THEN src.top_n ELSE 3 END)
        WHEN src.paint = 'r3_recognition'
          THEN jsonb_build_object('kind', 'rank_pool', 'pool', 'r3', 'draw', 'manual')
        WHEN src.paint = 'economy_week'
          THEN jsonb_build_object('kind', 'rank_pool', 'pool', 'r3', 'draw', 'wheel')
        WHEN src.mech = 'vs_high_score'
          THEN jsonb_build_object('kind', 'vs_top_n', 'topN', 1)
        WHEN src.mech = 'vs_top_10'
          THEN jsonb_build_object('kind', 'vs_top_n', 'topN', 10)
        WHEN src.mech = 'vs_top_n'
          THEN jsonb_build_object('kind', 'vs_top_n', 'topN',
            CASE WHEN src.top_n IN (1, 3, 5, 10) THEN src.top_n ELSE 10 END)
        WHEN src.mech = 'vr_top_n'
          THEN jsonb_build_object('kind', 'vr_top_n', 'topN',
            CASE WHEN src.top_n IN (3, 5, 10) THEN src.top_n ELSE 3 END)
        WHEN src.mech = 'r3_lottery'
          THEN jsonb_build_object('kind', 'rank_pool', 'pool', 'r3', 'draw', 'wheel')
        WHEN src.mech = 'heavy_hitter_lottery'
          THEN jsonb_build_object('kind', 'rank_pool', 'pool', 'heavy_hitter', 'draw', 'wheel')
        WHEN src.mech = 'r4_sequence'
          THEN jsonb_build_object('kind', 'rank_pool', 'pool', 'r4_plus', 'draw', 'wheel')
        WHEN src.mech = 'donations_top'
          THEN jsonb_build_object('kind', 'donations_top')
        WHEN src.mech = 'event_top_x_lottery'
          THEN jsonb_build_object('kind', 'event_top_x', 'eventKey', 'capitol_war', 'topN', 10)
        ELSE NULL
      END,
      vip_rule = CASE
        WHEN src.vip_mech = 'none'
          THEN jsonb_build_object('kind', 'none')
        WHEN src.vip_mech = 'donations_second'
          THEN jsonb_build_object('kind', 'donations_second')
        WHEN src.vip_mech = 'event_top_x_lottery'
          THEN jsonb_build_object(
            'kind', 'event_top_x',
            'eventKey', COALESCE(NULLIF(src.vip_cfg->>'eventKey', ''), 'capitol_war'),
            'topN', CASE
              WHEN src.vip_cfg->>'topN' ~ '^[0-9]+$' AND (src.vip_cfg->>'topN')::int > 0
                THEN (src.vip_cfg->>'topN')::int
              ELSE 10
            END)
        ELSE NULL
      END
    FROM src
    WHERE src.id = d.id;
  END IF;
END $$;
--> statement-breakpoint

-- Conductor records keep their mechanism columns as permanent history; the
-- rule columns are what new code reads.
ALTER TABLE train_conductor_records ADD COLUMN IF NOT EXISTS conductor_rule jsonb;
--> statement-breakpoint
ALTER TABLE train_conductor_records ADD COLUMN IF NOT EXISTS vip_rule jsonb;
--> statement-breakpoint

UPDATE train_conductor_records r
SET conductor_rule = d.conductor_rule, vip_rule = d.vip_rule
FROM train_day_configs d
WHERE d.id = r.day_config_id;
--> statement-breakpoint

UPDATE train_conductor_records r
SET conductor_rule = d.conductor_rule, vip_rule = d.vip_rule
FROM train_day_configs d
WHERE r.day_config_id IS NULL
  AND d.alliance_id = r.alliance_id
  AND d.date = r.date;
--> statement-breakpoint

-- Records with no surviving day config: decode from the recorded mechanism
-- alone. Paint is unknown here, so Price Is Freight days resolve to the rank
-- pool they were stored as — the same value the old history UI displayed.
UPDATE train_conductor_records r
SET
  conductor_rule = CASE
    WHEN r.conductor_mechanism = 'vs_high_score'
      THEN jsonb_build_object('kind', 'vs_top_n', 'topN', 1)
    WHEN r.conductor_mechanism = 'vs_top_10'
      THEN jsonb_build_object('kind', 'vs_top_n', 'topN', 10)
    WHEN r.conductor_mechanism = 'vs_top_n'
      THEN jsonb_build_object('kind', 'vs_top_n', 'topN', 10)
    WHEN r.conductor_mechanism = 'vr_top_n'
      THEN jsonb_build_object('kind', 'vr_top_n', 'topN', 3)
    WHEN r.conductor_mechanism = 'r3_lottery'
      THEN jsonb_build_object('kind', 'rank_pool', 'pool', 'r3', 'draw', 'wheel')
    WHEN r.conductor_mechanism = 'heavy_hitter_lottery'
      THEN jsonb_build_object('kind', 'rank_pool', 'pool', 'heavy_hitter', 'draw', 'wheel')
    WHEN r.conductor_mechanism = 'r4_sequence'
      THEN jsonb_build_object('kind', 'rank_pool', 'pool', 'r4_plus', 'draw', 'wheel')
    WHEN r.conductor_mechanism = 'donations_top'
      THEN jsonb_build_object('kind', 'donations_top')
    WHEN r.conductor_mechanism = 'event_top_x_lottery'
      THEN jsonb_build_object('kind', 'event_top_x', 'eventKey', 'capitol_war', 'topN', 10)
    ELSE NULL
  END,
  vip_rule = CASE
    WHEN r.vip_mechanism = 'none' THEN jsonb_build_object('kind', 'none')
    WHEN r.vip_mechanism = 'donations_second' THEN jsonb_build_object('kind', 'donations_second')
    WHEN r.vip_mechanism = 'event_top_x_lottery'
      THEN jsonb_build_object('kind', 'event_top_x', 'eventKey', 'capitol_war', 'topN', 10)
    ELSE NULL
  END
WHERE NOT EXISTS (
  SELECT 1 FROM train_day_configs d
  WHERE d.id = r.day_config_id
     OR (d.alliance_id = r.alliance_id AND d.date = r.date)
);
--> statement-breakpoint

ALTER TABLE train_day_configs DROP COLUMN IF EXISTS conductor_mechanism;
--> statement-breakpoint
ALTER TABLE train_day_configs DROP COLUMN IF EXISTS conductor_config;
--> statement-breakpoint
ALTER TABLE train_day_configs DROP COLUMN IF EXISTS vip_mechanism;
--> statement-breakpoint
ALTER TABLE train_day_configs DROP COLUMN IF EXISTS vip_config;
