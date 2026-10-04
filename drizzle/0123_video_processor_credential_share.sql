ALTER TABLE "alliance_video_processors" ADD COLUMN IF NOT EXISTS "via_credential_share_id" text;
--> statement-breakpoint
ALTER TABLE "alliance_video_processors" ADD CONSTRAINT "alliance_video_processors_via_credential_share_id_ashed_credential_shares_id_fk" FOREIGN KEY ("via_credential_share_id") REFERENCES "public"."ashed_credential_shares"("id") ON DELETE set null ON UPDATE no action;
