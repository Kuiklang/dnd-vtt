CREATE TYPE "public"."template_shape" AS ENUM('circle', 'cone', 'line', 'square');--> statement-breakpoint
CREATE TABLE "map_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"scene_id" uuid NOT NULL,
	"owner_id" uuid,
	"shape" "template_shape" NOT NULL,
	"x" double precision NOT NULL,
	"y" double precision NOT NULL,
	"size" real NOT NULL,
	"width" real DEFAULT 5 NOT NULL,
	"angle" real DEFAULT 0 NOT NULL,
	"color" text DEFAULT '#e0603a' NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN "music" jsonb;--> statement-breakpoint
ALTER TABLE "map_templates" ADD CONSTRAINT "map_templates_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_templates" ADD CONSTRAINT "map_templates_scene_id_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scenes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_templates" ADD CONSTRAINT "map_templates_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "map_templates_scene_idx" ON "map_templates" USING btree ("scene_id");