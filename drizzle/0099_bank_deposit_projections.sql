CREATE TABLE IF NOT EXISTS "bank_deposit_projections" (
	"id" text PRIMARY KEY NOT NULL,
	"alliance_id" text NOT NULL,
	"bank_id" text,
	"name" text NOT NULL,
	"notes" text,
	"as_of" timestamp with time zone NOT NULL,
	"horizon_hours" integer NOT NULL,
	"step_hours" integer DEFAULT 1 NOT NULL,
	"created_by_hq_user_id" text,
	"assumptions_json" jsonb,
	"points_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bank_deposit_projections" ADD CONSTRAINT "bank_deposit_projections_alliance_id_alliances_id_fk" FOREIGN KEY ("alliance_id") REFERENCES "public"."alliances"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bank_deposit_projections" ADD CONSTRAINT "bank_deposit_projections_bank_id_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "public"."banks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bank_deposit_projections" ADD CONSTRAINT "bank_deposit_projections_created_by_hq_user_id_hq_users_id_fk" FOREIGN KEY ("created_by_hq_user_id") REFERENCES "public"."hq_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bank_deposit_projections_alliance_created_idx" ON "bank_deposit_projections" USING btree ("alliance_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bank_deposit_projections_bank_created_idx" ON "bank_deposit_projections" USING btree ("bank_id","created_at");
