CREATE TABLE IF NOT EXISTS "commander_store_donation_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"alliance_id" text NOT NULL,
	"donor_hq_user_id" text NOT NULL,
	"recipient_ashed_member_id" text NOT NULL,
	"recipient_display_name" text,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"purchased_at" timestamp with time zone NOT NULL,
	"note" text,
	"tip_link_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "commander_store_tip_links" (
	"id" text PRIMARY KEY NOT NULL,
	"alliance_id" text NOT NULL,
	"ashed_member_id" text NOT NULL,
	"owner_hq_user_id" text NOT NULL,
	"code" text NOT NULL,
	"code_hint" text NOT NULL,
	"display_name_snapshot" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "commander_store_donation_receipts" ADD CONSTRAINT "commander_store_donation_receipts_alliance_id_alliances_id_fk" FOREIGN KEY ("alliance_id") REFERENCES "public"."alliances"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "commander_store_donation_receipts" ADD CONSTRAINT "commander_store_donation_receipts_donor_hq_user_id_hq_users_id_fk" FOREIGN KEY ("donor_hq_user_id") REFERENCES "public"."hq_users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "commander_store_tip_links" ADD CONSTRAINT "commander_store_tip_links_alliance_id_alliances_id_fk" FOREIGN KEY ("alliance_id") REFERENCES "public"."alliances"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "commander_store_tip_links" ADD CONSTRAINT "commander_store_tip_links_owner_hq_user_id_hq_users_id_fk" FOREIGN KEY ("owner_hq_user_id") REFERENCES "public"."hq_users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "csdr_alliance_purchased_idx" ON "commander_store_donation_receipts" USING btree ("alliance_id","purchased_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "csdr_alliance_donor_purchased_idx" ON "commander_store_donation_receipts" USING btree ("alliance_id","donor_hq_user_id","purchased_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cstl_code_unique" ON "commander_store_tip_links" USING btree ("code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cstl_alliance_member_idx" ON "commander_store_tip_links" USING btree ("alliance_id","ashed_member_id");
