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

UPDATE inbox_reminder_items SET active = 0, required_permission = 'vs_compliance:read'
WHERE kind IN ('vs_demotion_task', 'vs_kick_task');

CREATE TABLE IF NOT EXISTS vs_compliance_state (
  alliance_id text PRIMARY KEY REFERENCES alliances(id) ON DELETE CASCADE,
  input_version bigint NOT NULL DEFAULT 0,
  requested_from text,
  processed_through text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text
);
CREATE TABLE IF NOT EXISTS vs_compliance_evaluations (
  id text PRIMARY KEY,
  alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  member_id text NOT NULL,
  member_name text NOT NULL,
  week_ending text NOT NULL CHECK (extract(isodow FROM week_ending::date) = 7),
  input jsonb NOT NULL,
  evaluation jsonb NOT NULL,
  member_snapshot jsonb NOT NULL,
  remote_evidence jsonb NOT NULL DEFAULT '[]',
  remote_verified_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vs_compliance_evaluations_member_week_unique UNIQUE(alliance_id, member_id, week_ending)
);
CREATE TABLE IF NOT EXISTS vs_compliance_actions (
  id text PRIMARY KEY,
  alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  event_id text NOT NULL REFERENCES vs_compliance_evaluations(id) ON DELETE RESTRICT,
  member_id text NOT NULL,
  actor_id text NOT NULL,
  request_id text NOT NULL,
  request_digest text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('waive', 'demote', 'remove')),
  expected_rank integer,
  target_rank integer,
  evaluation_basis text NOT NULL,
  member_snapshot jsonb NOT NULL,
  reason text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vs_compliance_actions_request_unique UNIQUE(alliance_id, actor_id, request_id),
  CHECK ((kind = 'waive' AND reason IS NOT NULL AND length(trim(reason)) BETWEEN 1 AND 2000) OR (kind <> 'waive' AND reason IS NULL)),
  CHECK (kind <> 'demote' OR (expected_rank IS NOT NULL AND target_rank IS NOT NULL AND expected_rank BETWEEN 2 AND 4 AND target_rank BETWEEN 1 AND 3 AND target_rank < expected_rank)),
  CHECK (kind <> 'remove' OR (expected_rank IS NOT NULL AND expected_rank BETWEEN 1 AND 4 AND target_rank IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS vs_compliance_actions_settlement_unique ON vs_compliance_actions(event_id) WHERE kind <> 'waive';
CREATE UNIQUE INDEX IF NOT EXISTS vs_compliance_actions_waiver_unique ON vs_compliance_actions(event_id) WHERE kind = 'waive';
CREATE TABLE IF NOT EXISTS vs_compliance_sync_jobs (
  action_id text PRIMARY KEY REFERENCES vs_compliance_actions(id) ON DELETE RESTRICT,
  alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  member_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('local', 'pending', 'synced', 'failed', 'credentials_required')),
  attempts integer NOT NULL DEFAULT 0,
  lease_token text,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz,
  superseded_at timestamptz,
  superseded_by text
);
CREATE TABLE IF NOT EXISTS vs_compliance_roster_guards (
  alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  member_id text NOT NULL,
  action_id text NOT NULL REFERENCES vs_compliance_actions(id) ON DELETE RESTRICT,
  rank integer,
  status text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(alliance_id, member_id)
);
CREATE TABLE IF NOT EXISTS vs_compliance_reviews (
  id text PRIMARY KEY,
  alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  action_id text NOT NULL REFERENCES vs_compliance_actions(id) ON DELETE RESTRICT,
  evaluation_basis text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vs_compliance_reviews_basis_unique UNIQUE(action_id, evaluation_basis)
);
ALTER TABLE member_violations ADD COLUMN IF NOT EXISTS compliance_event_id text;
CREATE UNIQUE INDEX IF NOT EXISTS member_violations_compliance_event_id_unique ON member_violations(compliance_event_id);
CREATE UNIQUE INDEX IF NOT EXISTS vs_compliance_evaluations_scope_unique ON vs_compliance_evaluations(id, alliance_id, member_id);
CREATE UNIQUE INDEX IF NOT EXISTS vs_compliance_actions_scope_unique ON vs_compliance_actions(id, alliance_id, member_id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vs_compliance_actions_event_scope_fk') THEN
    ALTER TABLE vs_compliance_actions ADD CONSTRAINT vs_compliance_actions_event_scope_fk FOREIGN KEY(event_id, alliance_id, member_id) REFERENCES vs_compliance_evaluations(id, alliance_id, member_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vs_compliance_jobs_action_scope_fk') THEN
    ALTER TABLE vs_compliance_sync_jobs ADD CONSTRAINT vs_compliance_jobs_action_scope_fk FOREIGN KEY(action_id, alliance_id, member_id) REFERENCES vs_compliance_actions(id, alliance_id, member_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vs_compliance_guards_action_scope_fk') THEN
    ALTER TABLE vs_compliance_roster_guards ADD CONSTRAINT vs_compliance_guards_action_scope_fk FOREIGN KEY(action_id, alliance_id, member_id) REFERENCES vs_compliance_actions(id, alliance_id, member_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vs_compliance_violation_scope_fk') THEN
    ALTER TABLE member_violations ADD CONSTRAINT vs_compliance_violation_scope_fk FOREIGN KEY(compliance_event_id, alliance_id, ashed_member_id) REFERENCES vs_compliance_evaluations(id, alliance_id, member_id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION vs_compliance_invalidate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  row_data jsonb;
  tenant text;
  affected text;
  first_week text;
  member_key text;
  protected_row record;
BEGIN
  row_data := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  tenant := CASE WHEN TG_TABLE_NAME = 'alliances' THEN row_data->>'id' ELSE row_data->>'alliance_id' END;
  IF tenant IS NULL OR NOT EXISTS (SELECT 1 FROM alliances WHERE id = tenant) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'commander_alliance_memberships' THEN
    IF OLD.status = 'former' AND NEW.status = 'active' AND NEW.joined_at <= OLD.joined_at THEN
      NEW.joined_at := now();
      row_data := to_jsonb(NEW);
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF TG_TABLE_NAME = 'alliances' AND (row_data->>'operating_mode', row_data->>'ashed_alliance_id', row_data->>'owner_member_external_id') IS NOT DISTINCT FROM (to_jsonb(OLD)->>'operating_mode', to_jsonb(OLD)->>'ashed_alliance_id', to_jsonb(OLD)->>'owner_member_external_id') THEN RETURN NEW; END IF;
    IF TG_TABLE_NAME = 'time_off_sync_state' AND row_data->'snapshot' IS NOT DISTINCT FROM to_jsonb(OLD)->'snapshot' THEN RETURN NEW; END IF;
    IF TG_TABLE_NAME = 'vs_score_sync_scopes' AND row_data->'managed_scores' IS NOT DISTINCT FROM to_jsonb(OLD)->'managed_scores' THEN RETURN NEW; END IF;
    IF TG_TABLE_NAME = 'member_alliance_rank_events' AND (row_data - 'ashed_synced_at') = (to_jsonb(OLD) - 'ashed_synced_at') THEN RETURN NEW; END IF;
    IF TG_TABLE_NAME = 'alliance_members' AND (row_data->>'status', row_data->>'alliance_rank', row_data->>'join_date', row_data->>'current_name') IS NOT DISTINCT FROM (to_jsonb(OLD)->>'status', to_jsonb(OLD)->>'alliance_rank', to_jsonb(OLD)->>'join_date', to_jsonb(OLD)->>'current_name') THEN RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME = 'alliance_members' AND TG_OP = 'INSERT' THEN
    SELECT rank, status INTO protected_row FROM vs_compliance_roster_guards WHERE alliance_id = tenant AND member_id = row_data->>'ashed_member_id';
    IF FOUND THEN
      NEW.status := protected_row.status;
      NEW.alliance_rank := protected_row.rank;
      NEW.alliance_rank_title := NULL;
      NEW.ashed_rank_raw := CASE WHEN protected_row.rank IS NULL THEN NULL ELSE 'R' || protected_row.rank::text END;
      row_data := to_jsonb(NEW);
    END IF;
  END IF;
  IF TG_TABLE_NAME IN ('alliance_members', 'member_alliance_rank_events') THEN
    member_key := row_data->>'ashed_member_id';
    IF TG_OP <> 'UPDATE' OR TG_TABLE_NAME <> 'alliance_members' OR
      (to_jsonb(OLD)->>'alliance_rank', to_jsonb(OLD)->>'status') IS DISTINCT FROM (row_data->>'alliance_rank', row_data->>'status') THEN
      IF EXISTS (SELECT 1 FROM vs_compliance_sync_jobs WHERE alliance_id = tenant AND member_id = member_key
        AND lease_expires_at > now() AND action_id IS DISTINCT FROM current_setting('app.vs_compliance_action', true)) THEN
        RAISE EXCEPTION 'vs_compliance_busy' USING ERRCODE = '40001';
      END IF;
    END IF;
  END IF;
  SELECT min(effective_week) INTO first_week FROM vs_compliance_policies WHERE alliance_id = tenant AND enabled;
  affected := CASE WHEN TG_TABLE_NAME = 'vs_score_heads' THEN row_data->>'recorded_date'
    WHEN TG_TABLE_NAME = 'member_time_off' THEN row_data->>'start_date'
    WHEN TG_TABLE_NAME = 'vs_compliance_policies' THEN row_data->>'effective_week'
    ELSE first_week END;
  IF first_week IS NULL AND NOT (TG_TABLE_NAME = 'vs_compliance_policies' AND row_data->>'enabled' = 'true') THEN affected := NULL; END IF;
  IF affected IS NOT NULL THEN
    affected := GREATEST(first_week, (affected::date + ((7 - extract(dow FROM affected::date)::integer) % 7))::text);
  END IF;
  IF affected IS NOT NULL AND TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'member_time_off' THEN
    affected := GREATEST(first_week, LEAST(affected, ((OLD.start_date)::date + ((7 - extract(dow FROM (OLD.start_date)::date)::integer) % 7))::text));
  END IF;
  INSERT INTO vs_compliance_state(alliance_id, input_version, requested_from)
    VALUES (tenant, 1, affected)
    ON CONFLICT(alliance_id) DO UPDATE SET input_version = vs_compliance_state.input_version + 1,
      requested_from = LEAST(vs_compliance_state.requested_from, EXCLUDED.requested_from), next_attempt_at = now();
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['alliances', 'vs_score_heads', 'vs_score_sync_scopes', 'member_time_off', 'member_time_off_revisions', 'time_off_sync_bindings', 'time_off_sync_state', 'alliance_members', 'member_alliance_rank_events', 'member_alliance_tenure', 'commander_alliance_memberships', 'vs_compliance_policies'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'vs_compliance_inputs_changed' AND tgrelid = table_name::regclass) THEN
      EXECUTE format('CREATE TRIGGER vs_compliance_inputs_changed BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION vs_compliance_invalidate()', table_name);
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION vs_compliance_immutable_action() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'vs_compliance_immutable_action' USING ERRCODE = '23514';
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'vs_compliance_actions_immutable') THEN
    CREATE TRIGGER vs_compliance_actions_immutable BEFORE UPDATE OR DELETE ON vs_compliance_actions FOR EACH ROW EXECUTE FUNCTION vs_compliance_immutable_action();
  END IF;
END $$;
