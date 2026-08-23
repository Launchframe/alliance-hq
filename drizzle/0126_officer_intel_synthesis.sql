CREATE TABLE "officer_meeting_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"alliance_id" text NOT NULL,
	"session_id" text NOT NULL,
	"summary" text NOT NULL,
	"key_decisions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"open_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"synthesized_by_hq_user_id" text,
	"approved_by_hq_user_id" text,
	"approved_at" timestamp with time zone,
	"model_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "officer_action_items" (
	"id" text PRIMARY KEY NOT NULL,
	"alliance_id" text NOT NULL,
	"note_id" text NOT NULL,
	"session_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"assignee_alliance_member_id" text,
	"assignee_name_raw" text,
	"due_at" timestamp with time zone,
	"due_hint" text,
	"created_by_hq_user_id" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "officer_meeting_notes" ADD CONSTRAINT "officer_meeting_notes_alliance_id_alliances_id_fk" FOREIGN KEY ("alliance_id") REFERENCES "public"."alliances"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "officer_meeting_notes" ADD CONSTRAINT "officer_meeting_notes_session_id_officer_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."officer_chat_sessions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "officer_meeting_notes" ADD CONSTRAINT "officer_meeting_notes_synthesized_by_hq_user_id_hq_users_id_fk" FOREIGN KEY ("synthesized_by_hq_user_id") REFERENCES "public"."hq_users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "officer_meeting_notes" ADD CONSTRAINT "officer_meeting_notes_approved_by_hq_user_id_hq_users_id_fk" FOREIGN KEY ("approved_by_hq_user_id") REFERENCES "public"."hq_users"("id") ON DELETE set null ON UPDATE no action;

ALTER TABLE "officer_action_items" ADD CONSTRAINT "officer_action_items_alliance_id_alliances_id_fk" FOREIGN KEY ("alliance_id") REFERENCES "public"."alliances"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "officer_action_items" ADD CONSTRAINT "officer_action_items_note_id_officer_meeting_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."officer_meeting_notes"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "officer_action_items" ADD CONSTRAINT "officer_action_items_session_id_officer_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."officer_chat_sessions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "officer_action_items" ADD CONSTRAINT "officer_action_items_assignee_alliance_member_id_alliance_members_id_fk" FOREIGN KEY ("assignee_alliance_member_id") REFERENCES "public"."alliance_members"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "officer_action_items" ADD CONSTRAINT "officer_action_items_created_by_hq_user_id_hq_users_id_fk" FOREIGN KEY ("created_by_hq_user_id") REFERENCES "public"."hq_users"("id") ON DELETE set null ON UPDATE no action;

CREATE UNIQUE INDEX "officer_meeting_notes_session_idx" ON "officer_meeting_notes" USING btree ("session_id");
CREATE INDEX "officer_meeting_notes_alliance_updated_idx" ON "officer_meeting_notes" USING btree ("alliance_id","updated_at");
CREATE INDEX "officer_action_items_alliance_status_due_idx" ON "officer_action_items" USING btree ("alliance_id","status","due_at");
CREATE INDEX "officer_action_items_note_idx" ON "officer_action_items" USING btree ("note_id");
