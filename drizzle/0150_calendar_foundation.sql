CREATE TABLE train_boarding_windows (
  record_id text PRIMARY KEY REFERENCES train_conductor_records(id) ON DELETE CASCADE,
  alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  lock_at timestamptz NOT NULL, status text NOT NULL DEFAULT 'pending',
  starts_at timestamptz, ends_at timestamptz, basis text, observed_at timestamptz,
  remaining_seconds integer, version integer NOT NULL DEFAULT 1,
  request_id text, request_hash text, actor_id text, updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (remaining_seconds BETWEEN 0 AND 14400),
  CHECK (ends_at IS NULL OR ends_at = starts_at + interval '235 minutes')
);
CREATE INDEX train_boarding_alliance_idx ON train_boarding_windows(alliance_id, status);
CREATE TABLE calendar_preferences (
  hq_user_id text PRIMARY KEY REFERENCES hq_users(id) ON DELETE CASCADE,
  alerts jsonb NOT NULL DEFAULT '[]', locale text NOT NULL DEFAULT 'en-US',
  timezone text NOT NULL DEFAULT 'UTC', version integer NOT NULL DEFAULT 1
);
CREATE TABLE calendar_accounts (
  id text PRIMARY KEY, hq_user_id text NOT NULL UNIQUE REFERENCES hq_users(id) ON DELETE CASCADE,
  subject text NOT NULL, email text NOT NULL, refresh_token text, access_token text,
  expires_at timestamptz, status text NOT NULL DEFAULT 'connected', version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE calendar_oauth_states (
  hash text PRIMARY KEY, hq_user_id text NOT NULL REFERENCES hq_users(id) ON DELETE CASCADE,
  secret text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE calendar_targets (
  id text PRIMARY KEY, hq_user_id text NOT NULL REFERENCES hq_users(id) ON DELETE CASCADE,
  alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('apple', 'google')),
  sources jsonb NOT NULL, enabled boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1,
  feed_hash text UNIQUE, feed_secret text, remote_calendar_id text,
  account_id text REFERENCES calendar_accounts(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending', cleanup boolean NOT NULL DEFAULT false,
  lease_token text, lease_until timestamptz, next_sync_at timestamptz NOT NULL DEFAULT now(),
  last_sync_at timestamptz, last_fetch_at timestamptz, failure_count integer NOT NULL DEFAULT 0,
  CONSTRAINT calendar_target_owner_alliance_provider UNIQUE(hq_user_id, alliance_id, provider)
);
CREATE INDEX calendar_target_due_idx ON calendar_targets(provider, next_sync_at);
CREATE TABLE calendar_entries (
  target_id text NOT NULL REFERENCES calendar_targets(id) ON DELETE CASCADE,
  key text NOT NULL, uid text NOT NULL, payload jsonb NOT NULL, fingerprint text NOT NULL,
  revision integer NOT NULL DEFAULT 1, cancelled boolean NOT NULL DEFAULT false,
  remote_id text, remote_generation integer NOT NULL DEFAULT 0, applied_revision integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(target_id, key)
);
