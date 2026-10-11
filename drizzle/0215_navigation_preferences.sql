CREATE TABLE IF NOT EXISTS "navigation_preferences" (
	"hq_user_id" text PRIMARY KEY NOT NULL,
	"show_ashed_pages" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "navigation_preferences_hq_user_id_hq_users_id_fk" FOREIGN KEY ("hq_user_id") REFERENCES "public"."hq_users"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "navigation_favorites" (
	"hq_user_id" text NOT NULL,
	"destination_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "navigation_favorites_hq_user_id_destination_id_pk" PRIMARY KEY("hq_user_id","destination_id"),
	CONSTRAINT "navigation_favorites_hq_user_id_hq_users_id_fk" FOREIGN KEY ("hq_user_id") REFERENCES "public"."hq_users"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "navigation_recents" (
	"hq_user_id" text NOT NULL,
	"destination_id" text NOT NULL,
	"last_visited_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "navigation_recents_hq_user_id_destination_id_pk" PRIMARY KEY("hq_user_id","destination_id"),
	CONSTRAINT "navigation_recents_hq_user_id_hq_users_id_fk" FOREIGN KEY ("hq_user_id") REFERENCES "public"."hq_users"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "navigation_recents_user_time_idx" ON "navigation_recents" USING btree ("hq_user_id","last_visited_at" DESC NULLS LAST);
