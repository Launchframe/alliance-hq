ALTER TABLE support_team_reversals DROP CONSTRAINT IF EXISTS support_team_reversals_pkey;
ALTER TABLE support_team_reversals DROP CONSTRAINT IF EXISTS support_team_reversals_alliance_id_action_id_pk;
ALTER TABLE support_team_reversals ADD CONSTRAINT support_team_reversals_pkey PRIMARY KEY (alliance_id, action_id, reversal_id);
