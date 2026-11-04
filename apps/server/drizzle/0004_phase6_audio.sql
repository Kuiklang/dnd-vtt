CREATE TYPE "public"."audio_category" AS ENUM('music', 'ambient', 'sfx');--> statement-breakpoint
ALTER TYPE "public"."asset_kind" ADD VALUE 'audio' BEFORE 'other';--> statement-breakpoint
CREATE TABLE "audio_tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" "audio_category" DEFAULT 'music' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"duration_sec" real,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_audio" (
	"campaign_id" uuid PRIMARY KEY NOT NULL,
	"state" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "playlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"name" text NOT NULL,
	"track_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audio_tracks" ADD CONSTRAINT "audio_tracks_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_tracks" ADD CONSTRAINT "audio_tracks_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_tracks" ADD CONSTRAINT "audio_tracks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_audio" ADD CONSTRAINT "campaign_audio_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlists" ADD CONSTRAINT "playlists_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audio_tracks_campaign_idx" ON "audio_tracks" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "playlists_campaign_idx" ON "playlists" USING btree ("campaign_id");