CREATE TABLE IF NOT EXISTS "activity_events" (
	"id" text PRIMARY KEY NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"event_key" text NOT NULL,
	"feature" text NOT NULL,
	"kind" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"alliance_id" text,
	"actor_kind" text NOT NULL,
	"original_hq_user_id" text,
	"original_discord_user_id" text,
	"personal_owner_hq_user_id" text,
	"actor_commander_id" text,
	"actor_display_name" text,
	"actor_hq_role" text,
	"actor_game_rank" text,
	"server_number" text,
	"alliance_tag" text,
	"alliance_name" text,
	"channel" text,
	"method" text,
	"severity" text NOT NULL,
	"visibility_class" text NOT NULL,
	"resource_kind" text,
	"resource_id" text,
	"payload" jsonb NOT NULL,
	"source_namespace" text NOT NULL,
	"source_key" text NOT NULL,
	"content_hash" text NOT NULL,
	"historical" boolean DEFAULT false NOT NULL,
	"historical_current_labels" boolean DEFAULT false NOT NULL,
	CONSTRAINT "activity_events_schema_version_check" CHECK ("activity_events"."schema_version" = 1),
	CONSTRAINT "activity_events_kind_check" CHECK ("activity_events"."kind" in ('change', 'usage')),
	CONSTRAINT "activity_events_visibility_check" CHECK ("activity_events"."visibility_class" in ('alliance', 'private', 'platform')),
	CONSTRAINT "activity_events_actor_kind_check" CHECK ("activity_events"."actor_kind" in ('hq', 'discord', 'automation', 'unknown')),
	CONSTRAINT "activity_events_channel_check" CHECK ("activity_events"."channel" is null or "activity_events"."channel" in ('web', 'discord', 'integration', 'automation')),
	CONSTRAINT "activity_events_method_check" CHECK ("activity_events"."method" is null or "activity_events"."method" in ('manual', 'screenshot', 'video', 'import', 'sync', 'wheel')),
	CONSTRAINT "activity_events_severity_check" CHECK ("activity_events"."severity" in ('routine', 'update', 'override')),
	CONSTRAINT "activity_events_role_check" CHECK ("activity_events"."actor_hq_role" is null or "activity_events"."actor_hq_role" in ('owner', 'maintainer', 'officer', 'data_entry', 'member', 'viewer')),
	CONSTRAINT "activity_events_rank_check" CHECK ("activity_events"."actor_game_rank" is null or "activity_events"."actor_game_rank" in ('R1', 'R2', 'R3', 'R4', 'R5')),
	CONSTRAINT "activity_events_alliance_required_check" CHECK ("activity_events"."visibility_class" <> 'alliance' or "activity_events"."alliance_id" is not null),
	CONSTRAINT "activity_events_private_resource_check" CHECK ("activity_events"."visibility_class" <> 'private' or "activity_events"."resource_id" is null)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "activity_usage_dedupe" (
	"key" text PRIMARY KEY NOT NULL,
	"last_emitted_at" timestamp with time zone NOT NULL,
	"event_id" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_global_order_idx" ON "activity_events" USING btree ("occurred_at" DESC, "id" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_alliance_order_idx" ON "activity_events" USING btree ("alliance_id", "occurred_at" DESC, "id" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_personal_order_idx" ON "activity_events" USING btree ("personal_owner_hq_user_id", "occurred_at" DESC, "id" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_discord_owner_idx" ON "activity_events" USING btree ("original_discord_user_id", "personal_owner_hq_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "activity_source_unique" ON "activity_events" USING btree ("source_namespace", "source_key");
