CREATE TYPE "public"."wall_kind" AS ENUM('wall', 'door', 'secret');--> statement-breakpoint
CREATE TABLE "map_walls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"scene_id" uuid NOT NULL,
	"x1" double precision NOT NULL,
	"y1" double precision NOT NULL,
	"x2" double precision NOT NULL,
	"y2" double precision NOT NULL,
	"kind" "wall_kind" DEFAULT 'wall' NOT NULL,
	"open" boolean DEFAULT false NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN "vision" jsonb DEFAULT '{"enabled":false,"ambient":"bright"}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tokens" ADD COLUMN "sight" jsonb;--> statement-breakpoint
ALTER TABLE "tokens" ADD COLUMN "light" jsonb;--> statement-breakpoint
ALTER TABLE "map_walls" ADD CONSTRAINT "map_walls_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_walls" ADD CONSTRAINT "map_walls_scene_id_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scenes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "map_walls_scene_idx" ON "map_walls" USING btree ("scene_id");