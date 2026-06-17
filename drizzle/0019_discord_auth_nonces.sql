CREATE TABLE IF NOT EXISTS "discord_auth_nonces" (
	"id" text PRIMARY KEY NOT NULL,
	"nonce" text NOT NULL,
	"discord_user_id" text NOT NULL,
	"guild_id" text,
	"tag" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discord_auth_nonces_nonce_unique" UNIQUE("nonce")
);
