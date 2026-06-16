CREATE TABLE IF NOT EXISTS "member_alliance_rank_events" (
	"id" text PRIMARY KEY NOT NULL,
	"alliance_id" text NOT NULL,
	"ashed_member_id" text NOT NULL,
	"member_name" text NOT NULL,
	"alliance_rank" integer NOT NULL,
	"effective_date" text NOT NULL,
	"source" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_by_hq_user_id" text,
	"ashed_synced_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "member_alliance_rank_events_lookup_idx" ON "member_alliance_rank_events" ("alliance_id","ashed_member_id","effective_date" DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "train_week_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"alliance_id" text NOT NULL,
	"week_start" text NOT NULL,
	"template_type" text NOT NULL,
	"notes" text,
	"is_pivot" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "train_week_schedules_alliance_week_unique" UNIQUE("alliance_id","week_start")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "train_day_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"week_schedule_id" text,
	"alliance_id" text NOT NULL,
	"date" text NOT NULL,
	"conductor_mechanism" text NOT NULL,
	"conductor_config" jsonb,
	"vip_mechanism" text,
	"vip_config" jsonb,
	"is_override" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "train_day_configs_alliance_date_unique" UNIQUE("alliance_id","date")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "train_conductor_records" (
	"id" text PRIMARY KEY NOT NULL,
	"alliance_id" text NOT NULL,
	"date" text NOT NULL,
	"conductor_member_id" text,
	"conductor_member_name" text,
	"conductor_rank_event_id" text,
	"vip_member_id" text,
	"vip_member_name" text,
	"vip_rank_event_id" text,
	"guardian_is_vip" integer DEFAULT 0 NOT NULL,
	"conductor_mechanism" text,
	"vip_mechanism" text,
	"day_config_id" text,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "train_conductor_records_alliance_date_unique" UNIQUE("alliance_id","date")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conductor_pool_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"alliance_id" text NOT NULL,
	"pool_type" text NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL,
	"member_id" text NOT NULL,
	"member_name" text NOT NULL,
	"alliance_rank" integer,
	"sequence_position" integer,
	"selected_at" timestamp with time zone,
	"selected_for_date" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conductor_pool_entries_unique" UNIQUE("alliance_id","pool_type","generation","member_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory_item" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"image_url" text,
	"train_value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "inventory_item_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "train" (
	"id" text PRIMARY KEY NOT NULL,
	"conductor_record_id" text NOT NULL,
	"cargo_value_score" integer DEFAULT 0 NOT NULL,
	"trade_contracts_spent" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "train_conductor_record_unique" UNIQUE("conductor_record_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "train_car" (
	"id" text PRIMARY KEY NOT NULL,
	"train_id" text NOT NULL,
	"car_number" integer NOT NULL,
	CONSTRAINT "train_car_train_number_unique" UNIQUE("train_id","car_number")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "train_car_cargo_item" (
	"id" text PRIMARY KEY NOT NULL,
	"train_car_id" text NOT NULL,
	"slot_number" integer NOT NULL,
	"inventory_item_id" text,
	"quantity" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "train_car_cargo_item_slot_unique" UNIQUE("train_car_id","slot_number")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "train_cargo_snapshot" (
	"id" text PRIMARY KEY NOT NULL,
	"conductor_record_id" text NOT NULL,
	"snapshot_index" integer NOT NULL,
	"cargo_value_score" integer DEFAULT 0 NOT NULL,
	"trade_contracts_spent_cumulative" integer DEFAULT 0 NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "train_cargo_snapshot_car" (
	"id" text PRIMARY KEY NOT NULL,
	"snapshot_id" text NOT NULL,
	"car_number" integer NOT NULL,
	CONSTRAINT "train_cargo_snapshot_car_unique" UNIQUE("snapshot_id","car_number")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "train_cargo_snapshot_car_item" (
	"id" text PRIMARY KEY NOT NULL,
	"snapshot_car_id" text NOT NULL,
	"slot_number" integer NOT NULL,
	"inventory_item_id" text,
	"quantity" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "train_cargo_snapshot_car_item_slot_unique" UNIQUE("snapshot_car_id","slot_number")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "train_plunder_event" (
	"id" text PRIMARY KEY NOT NULL,
	"conductor_record_id" text NOT NULL,
	"plunder_number" integer NOT NULL,
	"plundered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "train_plunder_event_item" (
	"id" text PRIMARY KEY NOT NULL,
	"plunder_event_id" text NOT NULL,
	"inventory_item_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"train_car_number" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "train_rider" (
	"id" text PRIMARY KEY NOT NULL,
	"conductor_record_id" text NOT NULL,
	"member_id" text NOT NULL,
	"member_name" text NOT NULL,
	"car_number" integer NOT NULL,
	"boarding_result" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "train_rider_cargo_item" (
	"id" text PRIMARY KEY NOT NULL,
	"rider_id" text NOT NULL,
	"inventory_item_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"was_plundered" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "member_alliance_rank_events" ADD CONSTRAINT "member_alliance_rank_events_alliance_id_alliances_id_fk" FOREIGN KEY ("alliance_id") REFERENCES "public"."alliances"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "member_alliance_rank_events" ADD CONSTRAINT "member_alliance_rank_events_recorded_by_hq_user_id_hq_users_id_fk" FOREIGN KEY ("recorded_by_hq_user_id") REFERENCES "public"."hq_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "train_week_schedules" ADD CONSTRAINT "train_week_schedules_alliance_id_alliances_id_fk" FOREIGN KEY ("alliance_id") REFERENCES "public"."alliances"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "train_day_configs" ADD CONSTRAINT "train_day_configs_week_schedule_id_train_week_schedules_id_fk" FOREIGN KEY ("week_schedule_id") REFERENCES "public"."train_week_schedules"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "train_day_configs" ADD CONSTRAINT "train_day_configs_alliance_id_alliances_id_fk" FOREIGN KEY ("alliance_id") REFERENCES "public"."alliances"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "train_conductor_records" ADD CONSTRAINT "train_conductor_records_alliance_id_alliances_id_fk" FOREIGN KEY ("alliance_id") REFERENCES "public"."alliances"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "train_conductor_records" ADD CONSTRAINT "train_conductor_records_conductor_rank_event_id_member_alliance_rank_events_id_fk" FOREIGN KEY ("conductor_rank_event_id") REFERENCES "public"."member_alliance_rank_events"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "train_conductor_records" ADD CONSTRAINT "train_conductor_records_vip_rank_event_id_member_alliance_rank_events_id_fk" FOREIGN KEY ("vip_rank_event_id") REFERENCES "public"."member_alliance_rank_events"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "train_conductor_records" ADD CONSTRAINT "train_conductor_records_day_config_id_train_day_configs_id_fk" FOREIGN KEY ("day_config_id") REFERENCES "public"."train_day_configs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conductor_pool_entries" ADD CONSTRAINT "conductor_pool_entries_alliance_id_alliances_id_fk" FOREIGN KEY ("alliance_id") REFERENCES "public"."alliances"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "train" ADD CONSTRAINT "train_conductor_record_id_train_conductor_records_id_fk" FOREIGN KEY ("conductor_record_id") REFERENCES "public"."train_conductor_records"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "train_car" ADD CONSTRAINT "train_car_train_id_train_id_fk" FOREIGN KEY ("train_id") REFERENCES "public"."train"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "train_car_cargo_item" ADD CONSTRAINT "train_car_cargo_item_train_car_id_train_car_id_fk" FOREIGN KEY ("train_car_id") REFERENCES "public"."train_car"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "train_car_cargo_item" ADD CONSTRAINT "train_car_cargo_item_inventory_item_id_inventory_item_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_item"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "train_cargo_snapshot" ADD CONSTRAINT "train_cargo_snapshot_conductor_record_id_train_conductor_records_id_fk" FOREIGN KEY ("conductor_record_id") REFERENCES "public"."train_conductor_records"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "train_cargo_snapshot_car" ADD CONSTRAINT "train_cargo_snapshot_car_snapshot_id_train_cargo_snapshot_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."train_cargo_snapshot"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "train_cargo_snapshot_car_item" ADD CONSTRAINT "train_cargo_snapshot_car_item_snapshot_car_id_train_cargo_snapshot_car_id_fk" FOREIGN KEY ("snapshot_car_id") REFERENCES "public"."train_cargo_snapshot_car"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "train_cargo_snapshot_car_item" ADD CONSTRAINT "train_cargo_snapshot_car_item_inventory_item_id_inventory_item_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_item"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "train_plunder_event" ADD CONSTRAINT "train_plunder_event_conductor_record_id_train_conductor_records_id_fk" FOREIGN KEY ("conductor_record_id") REFERENCES "public"."train_conductor_records"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "train_plunder_event_item" ADD CONSTRAINT "train_plunder_event_item_plunder_event_id_train_plunder_event_id_fk" FOREIGN KEY ("plunder_event_id") REFERENCES "public"."train_plunder_event"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "train_plunder_event_item" ADD CONSTRAINT "train_plunder_event_item_inventory_item_id_inventory_item_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_item"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "train_rider" ADD CONSTRAINT "train_rider_conductor_record_id_train_conductor_records_id_fk" FOREIGN KEY ("conductor_record_id") REFERENCES "public"."train_conductor_records"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "train_rider_cargo_item" ADD CONSTRAINT "train_rider_cargo_item_rider_id_train_rider_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."train_rider"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "train_rider_cargo_item" ADD CONSTRAINT "train_rider_cargo_item_inventory_item_id_inventory_item_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_item"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
INSERT INTO "inventory_item" ("id", "slug", "name", "image_url", "train_value")
VALUES
  ('inv-speedup-1m', 'speedup-1m', '1-Minute Speedup', NULL, 10),
  ('inv-speedup-5m', 'speedup-5m', '5-Minute Speedup', NULL, 40),
  ('inv-speedup-1h', 'speedup-1h', '1-Hour Speedup', NULL, 400),
  ('inv-iron-1k', 'iron-1k', '1K Iron', NULL, 5),
  ('inv-food-1k', 'food-1k', '1K Food', NULL, 5),
  ('inv-gold-1k', 'gold-1k', '1K Gold', NULL, 8),
  ('inv-steel', 'steel', 'Steel', NULL, 15),
  ('inv-hero-exp', 'hero-exp', 'Hero EXP', NULL, 20)
ON CONFLICT ("slug") DO NOTHING;

--> statement-breakpoint
ALTER TABLE "member_alliance_rank_events" ADD COLUMN IF NOT EXISTS "alliance_rank_title" text;
