CREATE TABLE IF NOT EXISTS "train_day_top_score_spin_exclusions" (
	"id" text PRIMARY KEY NOT NULL,
	"alliance_id" text NOT NULL,
	"date" text NOT NULL,
	"member_id" text NOT NULL,
	"member_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "train_day_top_score_spin_exclusions" ADD CONSTRAINT "train_day_top_score_spin_exclusions_alliance_id_alliances_id_fk" FOREIGN KEY ("alliance_id") REFERENCES "public"."alliances"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "train_day_top_score_spin_exclusions_unique" ON "train_day_top_score_spin_exclusions" ("alliance_id","date","member_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "train_day_top_score_spin_exclusions_alliance_date_idx" ON "train_day_top_score_spin_exclusions" ("alliance_id","date");
