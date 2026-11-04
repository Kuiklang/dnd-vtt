CREATE TYPE "public"."timeline_visibility" AS ENUM('players', 'dm');--> statement-breakpoint
CREATE TABLE "timeline_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"session_id" uuid,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"in_world_date" text DEFAULT '' NOT NULL,
	"sort_key" integer DEFAULT 0 NOT NULL,
	"visibility" timeline_visibility DEFAULT 'players' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "game_sessions" ADD COLUMN "recap" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "game_sessions" ADD COLUMN "recap_published" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_session_id_game_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."game_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "timeline_events_campaign_idx" ON "timeline_events" USING btree ("campaign_id","sort_key");