-- Custom SQL migration file, put your code below! --
ALTER TABLE member_time_off ADD COLUMN IF NOT EXISTS activity_scope text NOT NULL DEFAULT 'all';
ALTER TABLE member_time_off ADD COLUMN IF NOT EXISTS sync_status text NOT NULL DEFAULT 'local';
ALTER TABLE member_time_off ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;
ALTER TABLE member_time_off ADD COLUMN IF NOT EXISTS notice_verified boolean NOT NULL DEFAULT true;
ALTER TABLE member_time_off ADD COLUMN IF NOT EXISTS private_notes_owned boolean NOT NULL DEFAULT false;
UPDATE member_time_off SET private_notes_owned = true
WHERE created_by_hq_user_id IS NOT NULL OR created_by_discord_user_id IS NOT NULL;
ALTER TABLE member_time_off_revisions ADD COLUMN IF NOT EXISTS observed_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS time_off_sync_bindings (
  id text PRIMARY KEY,
  alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  entry_id text NOT NULL REFERENCES member_time_off(id) ON DELETE RESTRICT,
  record_type text NOT NULL,
  origin text NOT NULL,
  remote_id text,
  app_id text,
  upstream_alliance_id text,
  remote_snapshot jsonb,
  status text NOT NULL DEFAULT 'pending',
  last_synced_at timestamptz,
  CONSTRAINT time_off_sync_bindings_entry_type_unique UNIQUE (entry_id, record_type),
  CONSTRAINT time_off_sync_bindings_remote_unique UNIQUE (alliance_id, remote_id)
);
CREATE TABLE IF NOT EXISTS time_off_sync_jobs (
  id text PRIMARY KEY,
  alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  binding_id text NOT NULL REFERENCES time_off_sync_bindings(id) ON DELETE RESTRICT,
  entry_version integer NOT NULL,
  desired jsonb,
  state text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  created_remote_id text,
  attempted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT time_off_sync_jobs_version_unique UNIQUE (binding_id, entry_version)
);
CREATE TABLE IF NOT EXISTS time_off_sync_tombstones (
  id text PRIMARY KEY,
  alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  app_id text NOT NULL,
  remote_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT time_off_sync_tombstones_remote_unique UNIQUE (alliance_id, app_id, remote_id)
);
CREATE TABLE IF NOT EXISTS time_off_sync_state (
  alliance_id text PRIMARY KEY REFERENCES alliances(id) ON DELETE CASCADE,
  requested_seq integer NOT NULL DEFAULT 0,
  processed_seq integer NOT NULL DEFAULT 0,
  lease_token text,
  lease_expires_at timestamptz,
  next_poll_at timestamptz NOT NULL DEFAULT now(),
  last_synced_at timestamptz,
  last_error text,
  snapshot jsonb NOT NULL DEFAULT '[]'::jsonb
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'member_time_off' AND column_name = 'ashed_excused_ids'
  ) THEN
    EXECUTE $backfill$
      INSERT INTO time_off_sync_bindings (id, alliance_id, entry_id, record_type, origin, remote_id, status)
      SELECT md5(e.id || ':' || ids.ordinality::text), e.alliance_id, e.id,
        CASE WHEN e.activity_scope = 'donation' THEN 'donation'
             WHEN e.activity_scope = 'vs' OR ids.ordinality = 1 THEN 'vs' ELSE 'donation' END,
        CASE WHEN e.created_by_hq_user_id IS NULL AND e.created_by_discord_user_id IS NULL THEN 'ashed' ELSE 'hq' END,
        ids.remote_id, 'conflict'
      FROM member_time_off e
      CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(e.ashed_excused_ids) = 'array' THEN e.ashed_excused_ids ELSE '[]'::jsonb END
      ) WITH ORDINALITY AS ids(remote_id, ordinality)
      WHERE ids.ordinality <= CASE WHEN e.activity_scope = 'all' THEN 2 ELSE 1 END
        AND length(ids.remote_id) > 0
      ON CONFLICT DO NOTHING
    $backfill$;
  END IF;
END $$;
