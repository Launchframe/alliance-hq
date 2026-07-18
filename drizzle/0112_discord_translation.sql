ALTER TABLE "discord_guild_alliances" ADD COLUMN "translation_enabled" boolean DEFAULT true NOT NULL;

ALTER TABLE "discord_user_prefs" ADD COLUMN "translation_language" text;

CREATE TABLE "discord_message_translations" (
	"message_id" text NOT NULL,
	"target_language" text NOT NULL,
	"content_hash" text NOT NULL,
	"translated_text" text NOT NULL,
	"detected_source_language" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discord_message_translations_message_id_target_language_pk" PRIMARY KEY("message_id","target_language")
);
