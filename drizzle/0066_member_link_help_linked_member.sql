ALTER TABLE hq_member_link_help_requests
  ADD COLUMN IF NOT EXISTS linked_ashed_member_id text;
