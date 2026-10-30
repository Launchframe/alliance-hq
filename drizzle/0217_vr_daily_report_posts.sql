CREATE TABLE IF NOT EXISTS "vr_daily_report_posts" (
  "id" text PRIMARY KEY NOT NULL,
  "guild_id" text NOT NULL,
  "alliance_id" text NOT NULL,
  "report_date" text NOT NULL,
  "status" text DEFAULT 'in_flight' NOT NULL,
  "claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "posted_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vr_daily_report_posts" ADD CONSTRAINT "vr_daily_report_posts_alliance_id_alliances_id_fk" FOREIGN KEY ("alliance_id") REFERENCES "public"."alliances"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vr_daily_report_posts_guild_report_date_unique" ON "vr_daily_report_posts" USING btree ("guild_id","report_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vr_daily_report_posts_alliance_idx" ON "vr_daily_report_posts" USING btree ("alliance_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vr_daily_report_posts_status_claimed_idx" ON "vr_daily_report_posts" USING btree ("status","claimed_at");
