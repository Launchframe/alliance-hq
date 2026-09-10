CREATE TABLE "officer_chat_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"alliance_id" text NOT NULL,
	"title" text NOT NULL,
	"channel_label" text,
	"session_at" timestamp with time zone,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by_hq_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "officer_chat_session_images" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"alliance_id" text NOT NULL,
	"storage_key" text NOT NULL,
	"sequence_order" integer NOT NULL,
	"width" integer,
	"height" integer,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "officer_chat_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"alliance_id" text NOT NULL,
	"sender_alliance_tag" text,
	"sender_name" text NOT NULL,
	"sender_level" integer,
	"sender_vip_level" integer,
	"original_text" text NOT NULL,
	"in_game_translated_text" text,
	"locale_text" text NOT NULL,
	"locale_code" text NOT NULL,
	"is_reply" boolean DEFAULT false NOT NULL,
	"reply_to_name" text,
	"sequence_order" integer NOT NULL,
	"source_image_index" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "officer_chat_translations" (
	"id" text PRIMARY KEY NOT NULL,
	"alliance_id" text NOT NULL,
	"content_hash" text NOT NULL,
	"target_language" text NOT NULL,
	"translated_text" text NOT NULL,
	"detected_source_language" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "officer_chat_sessions" ADD CONSTRAINT "officer_chat_sessions_alliance_id_alliances_id_fk" FOREIGN KEY ("alliance_id") REFERENCES "public"."alliances"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "officer_chat_sessions" ADD CONSTRAINT "officer_chat_sessions_created_by_hq_user_id_hq_users_id_fk" FOREIGN KEY ("created_by_hq_user_id") REFERENCES "public"."hq_users"("id") ON DELETE set null ON UPDATE no action;

ALTER TABLE "officer_chat_session_images" ADD CONSTRAINT "officer_chat_session_images_session_id_officer_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."officer_chat_sessions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "officer_chat_session_images" ADD CONSTRAINT "officer_chat_session_images_alliance_id_alliances_id_fk" FOREIGN KEY ("alliance_id") REFERENCES "public"."alliances"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "officer_chat_messages" ADD CONSTRAINT "officer_chat_messages_session_id_officer_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."officer_chat_sessions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "officer_chat_messages" ADD CONSTRAINT "officer_chat_messages_alliance_id_alliances_id_fk" FOREIGN KEY ("alliance_id") REFERENCES "public"."alliances"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "officer_chat_translations" ADD CONSTRAINT "officer_chat_translations_alliance_id_alliances_id_fk" FOREIGN KEY ("alliance_id") REFERENCES "public"."alliances"("id") ON DELETE cascade ON UPDATE no action;

CREATE INDEX "officer_chat_sessions_alliance_updated_idx" ON "officer_chat_sessions" USING btree ("alliance_id","updated_at");
CREATE INDEX "officer_chat_session_images_session_idx" ON "officer_chat_session_images" USING btree ("session_id","sequence_order");
CREATE INDEX "officer_chat_messages_session_order_idx" ON "officer_chat_messages" USING btree ("session_id","sequence_order");
CREATE UNIQUE INDEX "officer_chat_translations_alliance_hash_lang_idx" ON "officer_chat_translations" USING btree ("alliance_id","content_hash","target_language");
