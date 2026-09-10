ALTER TABLE plunder_plan_state ADD COLUMN IF NOT EXISTS next_tick_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS plunder_plan_tick_due_idx ON plunder_plan_state(next_tick_at);
